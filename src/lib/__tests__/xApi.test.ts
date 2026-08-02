import { describe, expect, it } from 'vitest';
import {
  percentEncode,
  buildSignatureBaseString,
  signHmacSha1,
  buildOAuthHeader,
  splitUrlParams,
  type XCredentials,
} from '../xApi';

// X(Twitter)開発者ドキュメント「Creating a signature」の既知テストベクタ。
// https://developer.x.com/en/docs/authentication/oauth-1-0a/creating-a-signature
const DOC_CREDS: XCredentials = {
  apiKey: 'xvz1evFS4wEEPTGEFPHBog',
  apiSecret: 'kAcSOqF21Fu85e7zjz7ZN2U4ZRhfV3WpwPAoE3Z7kBw',
  accessToken: '370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb',
  accessSecret: 'LswwdoUaIvS8ltyTt5jkRh4J50vUPVVHtR2YPi5kE',
};
const DOC_NONCE = 'kYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg';
const DOC_TIMESTAMP = '1318622958';
const DOC_URL = 'https://api.twitter.com/1.1/statuses/update.json';
const DOC_BODY_PARAMS = {
  include_entities: 'true',
  status: 'Hello Ladies + Gentlemen, a signed OAuth request!',
};
const DOC_EXPECTED_SIGNATURE = 'hCtSmYh+iHYCEqBWrE7C7hYmtUk=';

describe('percentEncode (RFC 3986)', () => {
  it('unreserved はそのまま・記号は大文字HEX', () => {
    expect(percentEncode('Ladies + Gentlemen')).toBe('Ladies%20%2B%20Gentlemen');
    expect(percentEncode('An encoded string!')).toBe('An%20encoded%20string%21');
    expect(percentEncode('Dogs, Cats & Mice')).toBe('Dogs%2C%20Cats%20%26%20Mice');
    expect(percentEncode('☃')).toBe('%E2%98%83');
    expect(percentEncode("!'()*")).toBe('%21%27%28%29%2A');
    expect(percentEncode('abc-._~XYZ019')).toBe('abc-._~XYZ019');
  });
});

describe('OAuth 1.0a HMAC-SHA1 署名 (Xドキュメント既知ベクタ)', () => {
  it('署名ベース文字列がドキュメントと一致する', () => {
    const base = buildSignatureBaseString('post', DOC_URL, {
      ...DOC_BODY_PARAMS,
      oauth_consumer_key: DOC_CREDS.apiKey,
      oauth_nonce: DOC_NONCE,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: DOC_TIMESTAMP,
      oauth_token: DOC_CREDS.accessToken,
      oauth_version: '1.0',
    });
    expect(base).toBe(
      'POST&https%3A%2F%2Fapi.twitter.com%2F1.1%2Fstatuses%2Fupdate.json&' +
        'include_entities%3Dtrue%26' +
        'oauth_consumer_key%3Dxvz1evFS4wEEPTGEFPHBog%26' +
        'oauth_nonce%3DkYjzVBB8Y0ZFabxSWbWovY3uYSQ2pTgmZeNu2VS4cg%26' +
        'oauth_signature_method%3DHMAC-SHA1%26' +
        'oauth_timestamp%3D1318622958%26' +
        'oauth_token%3D370773112-GmHxMAgYyLbNEtIKZeRNFsMKPR9EyMZeS9weJAEb%26' +
        'oauth_version%3D1.0%26' +
        'status%3DHello%2520Ladies%2520%252B%2520Gentlemen%252C%2520a%2520signed%2520OAuth%2520request%2521'
    );
  });

  it('署名がドキュメントの期待値と一致する', () => {
    const base = buildSignatureBaseString('POST', DOC_URL, {
      ...DOC_BODY_PARAMS,
      oauth_consumer_key: DOC_CREDS.apiKey,
      oauth_nonce: DOC_NONCE,
      oauth_signature_method: 'HMAC-SHA1',
      oauth_timestamp: DOC_TIMESTAMP,
      oauth_token: DOC_CREDS.accessToken,
      oauth_version: '1.0',
    });
    expect(signHmacSha1(base, DOC_CREDS.apiSecret, DOC_CREDS.accessSecret)).toBe(DOC_EXPECTED_SIGNATURE);
  });

  it('buildOAuthHeader が同じ署名を含むAuthorizationヘッダを組み立てる', () => {
    const header = buildOAuthHeader('POST', DOC_URL, DOC_CREDS, DOC_BODY_PARAMS, {
      nonce: DOC_NONCE,
      timestamp: DOC_TIMESTAMP,
    });
    expect(header.startsWith('OAuth ')).toBe(true);
    expect(header).toContain(`oauth_signature="${percentEncode(DOC_EXPECTED_SIGNATURE)}"`);
    expect(header).toContain('oauth_consumer_key="xvz1evFS4wEEPTGEFPHBog"');
    expect(header).toContain('oauth_signature_method="HMAC-SHA1"');
    expect(header).toContain('oauth_version="1.0"');
    // フォーム/ボディパラメータはヘッダには含めない(署名対象にのみ含める)
    expect(header).not.toContain('status=');
    expect(header).not.toContain('include_entities');
  });

  it('nonce/timestamp 未指定でも毎回ヘッダを生成できる', () => {
    const h = buildOAuthHeader('POST', 'https://api.x.com/2/tweets', DOC_CREDS);
    expect(h).toMatch(/oauth_nonce="[0-9a-f]{32}"/);
    expect(h).toMatch(/oauth_timestamp="\d+"/);
    expect(h).toMatch(/oauth_signature="[^"]+"/);
  });
});

// RFC 5849 §3.4.1.2: 署名ベース文字列のURIはクエリを含めてはいけない。
// RFC 5849 §3.4.1.3.1: クエリパラメータは署名対象のパラメータ集合に入れる。
// この2点を守らないとクエリ付きGET(= media upload の STATUS)が必ず401になる。
describe('splitUrlParams (クエリ付きURLの署名)', () => {
  it('URLをパス部分とクエリパラメータに分ける', () => {
    const { baseUrl, params } = splitUrlParams(
      'https://api.x.com/2/media/upload?command=STATUS&media_id=1880028106020515840'
    );
    expect(baseUrl).toBe('https://api.x.com/2/media/upload');
    expect(params).toEqual({ command: 'STATUS', media_id: '1880028106020515840' });
  });

  it('クエリが無ければパラメータは空', () => {
    const { baseUrl, params } = splitUrlParams('https://api.x.com/2/tweets');
    expect(baseUrl).toBe('https://api.x.com/2/tweets');
    expect(params).toEqual({});
  });

  it('パーセントエンコードされた値をデコードして返す(署名時に再エンコードされるため)', () => {
    const { params } = splitUrlParams('https://api.x.com/2/x?s=Hello%20Ladies%20%2B%20Gentlemen');
    expect(params.s).toBe('Hello Ladies + Gentlemen');
  });

  it('クエリで渡してもドキュメント既知ベクタと同じ署名になる', () => {
    // OAuth 1.0a はクエリパラメータとフォームパラメータを同じ集合として扱うので、
    // 既知ベクタのパラメータをクエリに移しても署名は変わらないはず。
    const url =
      `${DOC_URL}?include_entities=true&status=` +
      encodeURIComponent(DOC_BODY_PARAMS.status);
    const { baseUrl, params } = splitUrlParams(url);
    const header = buildOAuthHeader('POST', baseUrl, DOC_CREDS, params, {
      nonce: DOC_NONCE,
      timestamp: DOC_TIMESTAMP,
    });
    expect(header).toContain(`oauth_signature="${percentEncode(DOC_EXPECTED_SIGNATURE)}"`);
  });
});
