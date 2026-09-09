package storage

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

type Credentials struct {
	AccessKeyID, SecretAccessKey, SessionToken string
	Expiration                                 time.Time
}
type CloudOptions struct {
	Bucket, Region, Endpoint, PublicEndpoint string
	AllowHTTP, ForcePathStyle                bool
	Credentials                              func(context.Context) (Credentials, error)
}

func (o CloudOptions) Validate() error {
	if o.Bucket == "" || o.Region == "" {
		return fail("CONFIGURATION")
	}
	for _, e := range []string{o.Endpoint, o.PublicEndpoint} {
		if e == "" {
			continue
		}
		u, err := url.Parse(e)
		if err != nil || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") || u.Host == "" {
			return fail("CONFIGURATION")
		}
		if u.Scheme != "https" && !(o.AllowHTTP && u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "localhost")) {
			return fail("CONFIGURATION")
		}
	}
	private := regexp.MustCompile(`internal|privatelink|vpce[.-]|localhost|^127\.|^10\.|^192\.168\.|^172\.(?:1[6-9]|2[0-9]|3[01])\.`)
	internal := func(endpoint string) bool {
		u, _ := url.Parse(endpoint)
		return u != nil && private.MatchString(u.Hostname())
	}
	if !o.AllowHTTP && ((o.Endpoint != "" && internal(o.Endpoint) && o.PublicEndpoint == "") || (o.PublicEndpoint != "" && internal(o.PublicEndpoint))) {
		return fail("CONFIGURATION")
	}
	return nil
}
func (o CloudOptions) endpoint(public bool) string {
	if public && o.PublicEndpoint != "" {
		return o.PublicEndpoint
	}
	return o.Endpoint
}
func duration(ttl time.Duration, c Credentials) (time.Duration, error) {
	if ttl < time.Second || ttl > time.Hour {
		return 0, fail("INVALID_INPUT")
	}
	if !c.Expiration.IsZero() {
		remaining := time.Until(c.Expiration) - 10*time.Second
		if remaining < time.Second {
			return 0, fail("CONFIGURATION")
		}
		if ttl > remaining {
			ttl = remaining
		}
	}
	return ttl, nil
}
func statusError(status int) error {
	switch status {
	case 404:
		return fail("NOT_FOUND")
	case 401, 403:
		return fail("FORBIDDEN")
	case 409, 412:
		return fail("CONFLICT")
	}
	return &Error{Code: "UNAVAILABLE", Retryable: status == 429 || status >= 500}
}

type Cloud struct {
	name   string
	sign   func(context.Context, string, string, int64, string, time.Duration, bool) (SignedRequest, error)
	head   func(context.Context, string) (ObjectInfo, error)
	remove func(context.Context, string) error
	list   func(context.Context, ListInput) (Page, error)
}

func (p *Cloud) Name() string { return p.name }
func (p *Cloud) Capabilities() Capabilities {
	return Capabilities{DirectUpload: true, Extensions: []string{}}
}
func (p *Cloud) SignUpload(ctx context.Context, key string, size int64, contentType string, ttl time.Duration) (SignedRequest, error) {
	if e := ValidKey(key); e != nil {
		return SignedRequest{}, e
	}
	if e := validInput(PutInput{Body: strings.NewReader(""), Size: size, ContentType: contentType}); e != nil {
		return SignedRequest{}, e
	}
	return p.sign(ctx, "PUT", key, size, contentType, ttl, true)
}
func (p *Cloud) SignDownload(ctx context.Context, key string, ttl time.Duration) (SignedRequest, error) {
	if e := ValidKey(key); e != nil {
		return SignedRequest{}, e
	}
	return p.sign(ctx, "GET", key, 0, "", ttl, true)
}
func (p *Cloud) Head(ctx context.Context, key string) (ObjectInfo, error) {
	if e := ValidKey(key); e != nil {
		return ObjectInfo{}, e
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	v, e := p.head(ctx, key)
	return v, Normalize(e)
}
func (p *Cloud) Delete(ctx context.Context, key string) error {
	if e := ValidKey(key); e != nil {
		return e
	}
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	e := p.remove(ctx, key)
	if IsCode(e, "NOT_FOUND") {
		return nil
	}
	return Normalize(e)
}
func (p *Cloud) List(ctx context.Context, input ListInput) (Page, error) {
	n, e := limit(input.Limit)
	if e != nil {
		return Page{}, e
	}
	if len(input.Cursor) > 8192 || len(input.Prefix) > 1024 {
		return Page{}, fail("INVALID_INPUT")
	}
	input.Limit = n
	ctx, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	v, e := p.list(ctx, input)
	return v, Normalize(e)
}
func (p *Cloud) Get(ctx context.Context, key string) (Download, error) {
	if e := ValidKey(key); e != nil {
		return Download{}, e
	}
	s, e := p.sign(ctx, "GET", key, 0, "", 5*time.Minute, false)
	if e != nil {
		return Download{}, e
	}
	req, e := http.NewRequestWithContext(ctx, "GET", s.URL, nil)
	if e != nil {
		return Download{}, Normalize(e)
	}
	for k, v := range s.Headers {
		req.Header.Set(k, v)
	}
	res, e := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if e != nil {
		return Download{}, Normalize(e)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		res.Body.Close()
		return Download{}, statusError(res.StatusCode)
	}
	if res.ContentLength < 0 {
		res.Body.Close()
		return Download{}, fail("UNAVAILABLE")
	}
	return Download{Body: res.Body, Info: ObjectInfo{Key: key, Size: res.ContentLength, ContentType: res.Header.Get("Content-Type"), ETag: res.Header.Get("ETag"), ModifiedAt: res.Header.Get("Last-Modified")}}, nil
}

type exactReader struct {
	r          io.Reader
	size, seen int64
}

func (r *exactReader) Read(b []byte) (int, error) {
	n, e := r.r.Read(b)
	r.seen += int64(n)
	if r.seen > r.size || (e == io.EOF && r.seen != r.size) {
		return n, fail("INVALID_INPUT")
	}
	return n, e
}
func (p *Cloud) Put(ctx context.Context, key string, input PutInput) (ObjectInfo, error) {
	if e := ValidKey(key); e != nil {
		return ObjectInfo{}, e
	}
	if e := validInput(input); e != nil {
		return ObjectInfo{}, e
	}
	s, e := p.sign(ctx, "PUT", key, input.Size, input.ContentType, 5*time.Minute, false)
	if e != nil {
		return ObjectInfo{}, e
	}
	body := &exactReader{r: input.Body, size: input.Size}
	req, e := http.NewRequestWithContext(ctx, "PUT", s.URL, body)
	if e != nil {
		return ObjectInfo{}, Normalize(e)
	}
	req.ContentLength = input.Size
	if input.Size == 0 {
		var b [1]byte
		n, e := body.Read(b[:])
		if n != 0 || e != io.EOF {
			return ObjectInfo{}, fail("INVALID_INPUT")
		}
		req.Body = http.NoBody
	}
	for k, v := range s.Headers {
		req.Header.Set(k, v)
	}
	req.Header.Set("Content-Type", input.ContentType)
	res, e := (&http.Client{Timeout: 5 * time.Minute}).Do(req)
	if e != nil {
		return ObjectInfo{}, Normalize(e)
	}
	defer res.Body.Close()
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return ObjectInfo{}, statusError(res.StatusCode)
	}
	if body.seen != input.Size {
		return ObjectInfo{}, fail("INVALID_INPUT")
	}
	return ObjectInfo{Key: key, Size: input.Size, ContentType: input.ContentType, ETag: res.Header.Get("ETag")}, nil
}
