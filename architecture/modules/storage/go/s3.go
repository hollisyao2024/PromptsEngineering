package storage

import (
	"context"
	"errors"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"time"
)

func s3Error(e error) error {
	if e == nil {
		return nil
	}
	var status interface{ HTTPStatusCode() int }
	if errors.As(e, &status) {
		return statusError(status.HTTPStatusCode())
	}
	return Normalize(e)
}
func NewS3(o CloudOptions) (Provider, error) {
	if e := o.Validate(); e != nil {
		return nil, e
	}
	client := func(ctx context.Context, public bool) (*s3.Client, Credentials, error) {
		var creds Credentials
		opts := []func(*config.LoadOptions) error{config.WithRegion(o.Region)}
		if o.Credentials != nil {
			var e error
			creds, e = o.Credentials(ctx)
			if e != nil {
				return nil, creds, e
			}
			opts = append(opts, config.WithCredentialsProvider(aws.CredentialsProviderFunc(func(context.Context) (aws.Credentials, error) {
				return aws.Credentials{AccessKeyID: creds.AccessKeyID, SecretAccessKey: creds.SecretAccessKey, SessionToken: creds.SessionToken, CanExpire: !creds.Expiration.IsZero(), Expires: creds.Expiration}, nil
			})))
		}
		cfg, e := config.LoadDefaultConfig(ctx, opts...)
		if e != nil {
			return nil, creds, Normalize(e)
		}
		return s3.NewFromConfig(cfg, func(c *s3.Options) {
			if endpoint := o.endpoint(public); endpoint != "" {
				c.BaseEndpoint = aws.String(endpoint)
			}
			c.UsePathStyle = o.ForcePathStyle
			c.RequestChecksumCalculation = aws.RequestChecksumCalculationWhenRequired
			c.ResponseChecksumValidation = aws.ResponseChecksumValidationWhenRequired
		}), creds, nil
	}
	p := &Cloud{name: "s3"}
	p.sign = func(ctx context.Context, method, key string, size int64, contentType string, ttl time.Duration, public bool) (SignedRequest, error) {
		sdk, c, e := client(ctx, public)
		if e != nil {
			return SignedRequest{}, e
		}
		ttl, e = duration(ttl, c)
		if e != nil {
			return SignedRequest{}, e
		}
		presigner := s3.NewPresignClient(sdk)
		headers := map[string]string{}
		result := SignedRequest{Method: method, Headers: headers, ExpiresAt: time.Now().Add(ttl).UTC().Format(time.RFC3339Nano)}
		if method == "PUT" {
			r, e := presigner.PresignPutObject(ctx, &s3.PutObjectInput{Bucket: aws.String(o.Bucket), Key: aws.String(key), ContentType: aws.String(contentType), ContentLength: aws.Int64(size)}, s3.WithPresignExpires(ttl))
			if e != nil {
				return result, s3Error(e)
			}
			result.URL = r.URL
			for k, v := range r.SignedHeader {
				if len(v) > 0 && k != "Host" && k != "Content-Length" {
					headers[k] = v[0]
				}
			}
			headers["Content-Type"] = contentType
		} else {
			r, e := presigner.PresignGetObject(ctx, &s3.GetObjectInput{Bucket: aws.String(o.Bucket), Key: aws.String(key), ResponseContentDisposition: aws.String("attachment")}, s3.WithPresignExpires(ttl))
			if e != nil {
				return result, s3Error(e)
			}
			result.URL = r.URL
		}
		return result, nil
	}
	p.head = func(ctx context.Context, key string) (ObjectInfo, error) {
		sdk, _, e := client(ctx, false)
		if e != nil {
			return ObjectInfo{}, e
		}
		r, e := sdk.HeadObject(ctx, &s3.HeadObjectInput{Bucket: aws.String(o.Bucket), Key: aws.String(key)})
		if e != nil {
			return ObjectInfo{}, s3Error(e)
		}
		return ObjectInfo{Key: key, Size: aws.ToInt64(r.ContentLength), ContentType: aws.ToString(r.ContentType), ETag: aws.ToString(r.ETag)}, nil
	}
	p.remove = func(ctx context.Context, key string) error {
		sdk, _, e := client(ctx, false)
		if e != nil {
			return e
		}
		_, e = sdk.DeleteObject(ctx, &s3.DeleteObjectInput{Bucket: aws.String(o.Bucket), Key: aws.String(key)})
		return s3Error(e)
	}
	p.list = func(ctx context.Context, in ListInput) (Page, error) {
		sdk, _, e := client(ctx, false)
		if e != nil {
			return Page{}, e
		}
		req := &s3.ListObjectsV2Input{Bucket: aws.String(o.Bucket), Prefix: aws.String(in.Prefix), MaxKeys: aws.Int32(int32(in.Limit))}
		if in.Cursor != "" {
			req.ContinuationToken = aws.String(in.Cursor)
		}
		r, e := sdk.ListObjectsV2(ctx, req)
		if e != nil {
			return Page{}, s3Error(e)
		}
		p := Page{Items: []ObjectInfo{}, Cursor: aws.ToString(r.NextContinuationToken)}
		for _, v := range r.Contents {
			p.Items = append(p.Items, ObjectInfo{Key: aws.ToString(v.Key), Size: aws.ToInt64(v.Size), ContentType: "application/octet-stream", ETag: aws.ToString(v.ETag)})
		}
		return p, nil
	}
	return p, nil
}
