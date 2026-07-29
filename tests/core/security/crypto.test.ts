import { describe, expect, it } from 'vitest';
import {
  type EncryptedBlob,
  decryptString,
  encryptString,
  generateRecoveryCode,
  isStrongPassword,
  sha256Hex,
} from '../../../src/core/security/crypto';

describe('crypto - 加解密往返', () => {
  it('encryptString → decryptString 还原原文', async () => {
    const plaintext = '你好世界！Hello World! 12345';
    const blob = await encryptString(plaintext, 'my-password-123');
    const decrypted = await decryptString(blob, 'my-password-123');
    expect(decrypted).toBe(plaintext);
  });

  it('加密结果不包含明文', async () => {
    const plaintext = 'sensitive-data-12345';
    const blob = await encryptString(plaintext, 'password');
    const blobStr = JSON.stringify(blob);
    expect(blobStr).not.toContain(plaintext);
  });

  it('每次加密生成不同密文（随机 IV + salt）', async () => {
    const plaintext = 'same text';
    const blob1 = await encryptString(plaintext, 'pwd');
    const blob2 = await encryptString(plaintext, 'pwd');
    expect(blob1.ciphertext).not.toBe(blob2.ciphertext);
    expect(blob1.iv).not.toBe(blob2.iv);
    expect(blob1.salt).not.toBe(blob2.salt);
  });

  it('EncryptedBlob 结构正确', async () => {
    const blob = await encryptString('test', 'pwd');
    expect(blob.alg).toBe('AES-GCM-256');
    expect(blob.iterations).toBe(600_000);
    expect(blob.ciphertext).toBeTruthy();
    expect(blob.iv).toBeTruthy();
    expect(blob.salt).toBeTruthy();
  });
});

describe('crypto - 错误密码', () => {
  it('错误密码解密抛出异常', async () => {
    const blob = await encryptString('secret', 'correct-password');
    await expect(decryptString(blob, 'wrong-password')).rejects.toThrow('密码错误或数据已损坏');
  });

  it('空密码解密抛出异常', async () => {
    const blob = await encryptString('secret', 'correct-password');
    await expect(decryptString(blob, '')).rejects.toThrow();
  });
});

describe('crypto - 数据完整性', () => {
  it('篡改密文后解密失败（GCM 认证标签校验）', async () => {
    const blob = await encryptString('original', 'pwd');
    // 篡改 ciphertext 的最后一个字符
    const tampered: EncryptedBlob = {
      ...blob,
      ciphertext: blob.ciphertext.slice(0, -1) + (blob.ciphertext.slice(-1) === 'A' ? 'B' : 'A'),
    };
    await expect(decryptString(tampered, 'pwd')).rejects.toThrow();
  });

  it('篡改 IV 后解密失败', async () => {
    const blob = await encryptString('original', 'pwd');
    const tampered: EncryptedBlob = {
      ...blob,
      iv: blob.iv.slice(0, -1) + (blob.iv.slice(-1) === 'A' ? 'B' : 'A'),
    };
    await expect(decryptString(tampered, 'pwd')).rejects.toThrow();
  });
});

describe('crypto - sha256Hex', () => {
  it('相同输入产生相同哈希', async () => {
    const h1 = await sha256Hex('test');
    const h2 = await sha256Hex('test');
    expect(h1).toBe(h2);
  });

  it('不同输入产生不同哈希', async () => {
    const h1 = await sha256Hex('test1');
    const h2 = await sha256Hex('test2');
    expect(h1).not.toBe(h2);
  });

  it('哈希为 64 字符 hex 字符串', async () => {
    const h = await sha256Hex('test');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('已知向量校验：sha256("abc") = 已知值', async () => {
    const h = await sha256Hex('abc');
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('crypto - generateRecoveryCode', () => {
  it('格式为 XXXX-XXXX-XXXX', () => {
    const code = generateRecoveryCode();
    expect(code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('每次生成不同恢复码', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 100; i++) {
      codes.add(generateRecoveryCode());
    }
    // 100 个码几乎不可能全相同
    expect(codes.size).toBeGreaterThan(90);
  });

  it('不包含易混字符（0/O/1/I）', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateRecoveryCode();
      expect(code).not.toMatch(/[01OI]/);
    }
  });
});

describe('crypto - isStrongPassword', () => {
  it('≥8 位且含字母+数字 → true', () => {
    expect(isStrongPassword('abc12345')).toBe(true);
    expect(isStrongPassword('Password1')).toBe(true);
    expect(isStrongPassword('a1b2c3d4')).toBe(true);
  });

  it('< 8 位 → false', () => {
    expect(isStrongPassword('abc123')).toBe(false);
    expect(isStrongPassword('a1')).toBe(false);
    expect(isStrongPassword('')).toBe(false);
  });

  it('纯字母 → false', () => {
    expect(isStrongPassword('abcdefgh')).toBe(false);
    expect(isStrongPassword('Password')).toBe(false);
  });

  it('纯数字 → false', () => {
    expect(isStrongPassword('12345678')).toBe(false);
    expect(isStrongPassword('00000000')).toBe(false);
  });
});

describe('crypto - 大数据量加解密', () => {
  it('10KB JSON 数据加解密往返', async () => {
    const large = JSON.stringify({
      data: Array.from({ length: 1000 }, (_, i) => ({ id: i, name: `item-${i}`, value: i * 1.5 })),
    });
    const blob = await encryptString(large, 'pwd');
    const decrypted = await decryptString(blob, 'pwd');
    expect(decrypted).toBe(large);
    expect(JSON.parse(decrypted).data).toHaveLength(1000);
  });

  it('Unicode/Emoji 加解密往返', async () => {
    const text = '🎉富贵不能淫，贫贱不能移🍕αβγδ';

  const blob = await encryptString(text, '密码123');
    const decrypted = await decryptString(blob, '密码123');
    expect(decrypted).toBe(text);
  });
});
