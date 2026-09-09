package storage

import (
	"context"
	"errors"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"
	"time"
)

func ossError(e error) error {
	if e == nil {
		return nil
	}
	var service *oss.ServiceError
	if errors.As(e, &service) {
		return statusError(service.StatusCode)
	}
	return Normalize(e)
}
func NewAliyunOSS(o CloudOptions) (Provider, error) {
	if e := o.Validate(); e != nil {
		return nil, e
	}
	if o.Credentials == nil {
		return nil, fail("CONFIGURATION")
	}
	client := func(ctx context.Context, public bool) (*oss.Client, Credentials, error) {
		c, e := o.Credentials(ctx)
		if e != nil {
			return nil, c, e
		}
		cfg := oss.LoadDefaultConfig().WithRegion(o.Region).WithAdditionalHeaders([]string{"content-length"}).WithCredentialsProvider(credentials.NewStaticCredentialsProvider(c.AccessKeyID, c.SecretAccessKey, c.SessionToken))
		if ep := o.endpoint(public); ep != "" {
			cfg = cfg.WithEndpoint(ep)
		}
		return oss.NewClient(cfg), c, nil
	}
	p := &Cloud{name: "aliyun-oss"}
	p.sign = func(ctx context.Context, method, key string, size int64, contentType string, ttl time.Duration, public bool) (SignedRequest, error) {
		sdk, c, e := client(ctx, public)
		if e != nil {
			return SignedRequest{}, e
		}
		ttl, e = duration(ttl, c)
		if e != nil {
			return SignedRequest{}, e
		}
		var request any = &oss.GetObjectRequest{Bucket: oss.Ptr(o.Bucket), Key: oss.Ptr(key), ResponseContentDisposition: oss.Ptr("attachment")}
		if method == "PUT" {
			request = &oss.PutObjectRequest{Bucket: oss.Ptr(o.Bucket), Key: oss.Ptr(key), ContentType: oss.Ptr(contentType), ContentLength: oss.Ptr(size)}
		}
		r, e := sdk.Presign(ctx, request, oss.PresignExpires(ttl))
		if e != nil {
			return SignedRequest{}, ossError(e)
		}
		delete(r.SignedHeaders, "Content-Length")
		return SignedRequest{Method: method, URL: r.URL, Headers: r.SignedHeaders, ExpiresAt: r.Expiration.UTC().Format(time.RFC3339Nano)}, nil
	}
	p.head = func(ctx context.Context, key string) (ObjectInfo, error) {
		sdk, _, e := client(ctx, false)
		if e != nil {
			return ObjectInfo{}, e
		}
		r, e := sdk.HeadObject(ctx, &oss.HeadObjectRequest{Bucket: oss.Ptr(o.Bucket), Key: oss.Ptr(key)})
		if e != nil {
			return ObjectInfo{}, ossError(e)
		}
		return ObjectInfo{Key: key, Size: r.ContentLength, ContentType: oss.ToString(r.ContentType), ETag: oss.ToString(r.ETag)}, nil
	}
	p.remove = func(ctx context.Context, key string) error {
		sdk, _, e := client(ctx, false)
		if e != nil {
			return e
		}
		_, e = sdk.DeleteObject(ctx, &oss.DeleteObjectRequest{Bucket: oss.Ptr(o.Bucket), Key: oss.Ptr(key)})
		return ossError(e)
	}
	p.list = func(ctx context.Context, in ListInput) (Page, error) {
		sdk, _, e := client(ctx, false)
		if e != nil {
			return Page{}, e
		}
		r, e := sdk.ListObjectsV2(ctx, &oss.ListObjectsV2Request{Bucket: oss.Ptr(o.Bucket), Prefix: oss.Ptr(in.Prefix), ContinuationToken: oss.Ptr(in.Cursor), MaxKeys: int32(in.Limit)})
		if e != nil {
			return Page{}, ossError(e)
		}
		p := Page{Items: []ObjectInfo{}, Cursor: oss.ToString(r.NextContinuationToken)}
		for _, v := range r.Contents {
			p.Items = append(p.Items, ObjectInfo{Key: oss.ToString(v.Key), Size: v.Size, ContentType: "application/octet-stream", ETag: oss.ToString(v.ETag)})
		}
		return p, nil
	}
	return p, nil
}
