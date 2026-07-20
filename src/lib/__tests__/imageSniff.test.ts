import { describe, it, expect } from 'vitest';
import { sniffImageType } from '../imageSniff';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const GIF87 = Buffer.from('GIF87a' + '\x00'.repeat(4), 'latin1');
const GIF89 = Buffer.from('GIF89a' + '\x00'.repeat(4), 'latin1');
const WEBP = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'latin1'),
]);

describe('sniffImageType (M23: 拡張子偽装アップロードの検出)', () => {
  it('本物の画像を正しく判定する', () => {
    expect(sniffImageType(JPEG)).toBe('jpeg');
    expect(sniffImageType(PNG)).toBe('png');
    expect(sniffImageType(GIF87)).toBe('gif');
    expect(sniffImageType(GIF89)).toBe('gif');
    expect(sniffImageType(WEBP)).toBe('webp');
  });

  it('画像でないものを拒否する(拡張子だけpngのPHP等)', () => {
    expect(sniffImageType(Buffer.from('<?php system($_GET["c"]); ?>', 'latin1'))).toBeNull();
    expect(sniffImageType(Buffer.from('#!/bin/sh\nrm -rf /', 'latin1'))).toBeNull();
    expect(sniffImageType(Buffer.from('{"just":"json"}', 'latin1'))).toBeNull();
    // ZIP(PK) を .png にリネームした想定
    expect(sniffImageType(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]))).toBeNull();
  });

  it('短すぎる/空のバッファでクラッシュしない', () => {
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
    expect(sniffImageType(Buffer.from([0xff]))).toBeNull();
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    // PNGシグネチャの途中で切れている
    expect(sniffImageType(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it('シグネチャが惜しいだけのものは通さない', () => {
    // JPEGの3バイト目が違う
    expect(sniffImageType(Buffer.from([0xff, 0xd8, 0xfe, 0x00]))).toBeNull();
    // GIF88a は存在しない
    expect(sniffImageType(Buffer.from('GIF88a\x00\x00\x00\x00', 'latin1'))).toBeNull();
    // RIFFだがWEBPではない(WAVファイル)
    expect(
      sniffImageType(
        Buffer.concat([
          Buffer.from('RIFF', 'latin1'),
          Buffer.from([0, 0, 0, 0]),
          Buffer.from('WAVE', 'latin1'),
        ])
      )
    ).toBeNull();
  });
});
