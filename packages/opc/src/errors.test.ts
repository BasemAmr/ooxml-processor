import { describe, expect, it } from 'vitest';

import {
  OpcContentTypeError,
  OpcEncryptedPackageError,
  OpcError,
  OpcLimitError,
  OpcPackageError,
  OpcPartNameError,
  OpcRelationshipError,
  OpcZipError,
  type OpcErrorKind,
} from './errors.js';

describe('OpcError taxonomy', () => {
  it('instantiates each error subclass with the correct kind and class name', () => {
    const partNameErr = new OpcPartNameError('empty-segment', '/word//doc.xml', 'Empty segment');
    expect(partNameErr).toBeInstanceOf(OpcError);
    expect(partNameErr).toBeInstanceOf(Error);
    expect(partNameErr.name).toBe('OpcPartNameError');
    expect(partNameErr.kind).toBe('part-name');
    expect(partNameErr.code).toBe('empty-segment');
    expect(partNameErr.partName).toBe('/word//doc.xml');

    const zipErr = new OpcZipError('eocd-not-found', 'No EOCD', 'test.zip');
    expect(zipErr).toBeInstanceOf(OpcError);
    expect(zipErr.name).toBe('OpcZipError');
    expect(zipErr.kind).toBe('zip');
    expect(zipErr.code).toBe('eocd-not-found');
    expect(zipErr.entryName).toBe('test.zip');

    const limitErr = new OpcLimitError('maxEntryCount', 10, 15, 'entry.xml');
    expect(limitErr).toBeInstanceOf(OpcError);
    expect(limitErr.name).toBe('OpcLimitError');
    expect(limitErr.kind).toBe('limit');
    expect(limitErr.limit).toBe('maxEntryCount');
    expect(limitErr.code).toBe('too-many-entries');
    expect(limitErr.allowed).toBe(10);
    expect(limitErr.observed).toBe(15);
    expect(limitErr.entryName).toBe('entry.xml');

    const encErr = new OpcEncryptedPackageError('ole-compound-file', 'Encrypted file');
    expect(encErr).toBeInstanceOf(OpcError);
    expect(encErr.name).toBe('OpcEncryptedPackageError');
    expect(encErr.kind).toBe('encrypted');
    expect(encErr.detectedAs).toBe('ole-compound-file');

    const ctErr = new OpcContentTypeError('duplicate-default', 'Duplicate extension', 'png');
    expect(ctErr).toBeInstanceOf(OpcError);
    expect(ctErr.name).toBe('OpcContentTypeError');
    expect(ctErr.kind).toBe('content-type');
    expect(ctErr.code).toBe('duplicate-default');
    expect(ctErr.subject).toBe('png');

    const relErr = new OpcRelationshipError(
      'duplicate-id',
      'Duplicate relationship Id',
      '/_rels/.rels',
      'rId1',
    );
    expect(relErr).toBeInstanceOf(OpcError);
    expect(relErr.name).toBe('OpcRelationshipError');
    expect(relErr.kind).toBe('relationship');
    expect(relErr.code).toBe('duplicate-id');
    expect(relErr.partName).toBe('/_rels/.rels');
    expect(relErr.relationshipId).toBe('rId1');

    const pkgErr = new OpcPackageError(
      'missing-content-types',
      'Missing [Content_Types].xml',
      '[Content_Types].xml',
    );
    expect(pkgErr).toBeInstanceOf(OpcError);
    expect(pkgErr.name).toBe('OpcPackageError');
    expect(pkgErr.kind).toBe('package');
    expect(pkgErr.code).toBe('missing-content-types');
    expect(pkgErr.subject).toBe('[Content_Types].xml');
  });

  it('discriminates cleanly via error.kind without relying on instanceof', () => {
    const errors: OpcError[] = [
      new OpcPartNameError('dot-segment', '/../etc', 'escapes'),
      new OpcZipError('truncated', 'Archive truncated', 'item'),
      new OpcLimitError('maxArchiveBytes', 100, 200),
      new OpcEncryptedPackageError('zip-entry-encrypted', 'Encrypted entry'),
      new OpcContentTypeError('invalid-extension', 'Bad ext', '.xyz'),
      new OpcRelationshipError('unknown-id', 'Unknown rId', '/word/document.xml', 'rId99'),
      new OpcPackageError('part-not-found', 'Part missing', '/word/styles.xml'),
    ];

    const classified = errors.map((err) => {
      // Discriminant switch over kind
      const kind: OpcErrorKind = err.kind;
      switch (kind) {
        case 'part-name':
          return `part-name: ${(err as OpcPartNameError).partName}`;
        case 'zip':
          return `zip: ${(err as OpcZipError).code}`;
        case 'limit':
          return `limit: ${(err as OpcLimitError).limit}`;
        case 'encrypted':
          return `encrypted: ${(err as OpcEncryptedPackageError).detectedAs}`;
        case 'content-type':
          return `content-type: ${(err as OpcContentTypeError).code}`;
        case 'relationship':
          return `relationship: ${(err as OpcRelationshipError).relationshipId}`;
        case 'package':
          return `package: ${(err as OpcPackageError).code}`;
      }
    });

    expect(classified).toEqual([
      'part-name: /../etc',
      'zip: truncated',
      'limit: maxArchiveBytes',
      'encrypted: zip-entry-encrypted',
      'content-type: invalid-extension',
      'relationship: rId99',
      'package: part-not-found',
    ]);
  });

  it('preserves untruncated subject/partName/entryName/relId on the error object even when truncated in message', () => {
    const longName = '/' + 'a'.repeat(300) + '.xml';
    const err = new OpcPartNameError('too-long', longName, 'Part name too long');

    // Untruncated property on object
    expect(err.partName).toBe(longName);
    expect(err.partName.length).toBe(305);

    // Truncated in message to avoid DoS
    expect(err.message).toContain('… (+');
    expect(err.message.length).toBeLessThan(longName.length);
  });

  it('supports error causes where provided', () => {
    const underlying = new Error('Disk read failure');
    const zipErr = new OpcZipError('inflate-failed', 'Inflate failed', 'word/document.xml', {
      cause: underlying,
    });
    expect(zipErr.cause).toBe(underlying);

    const relErr = new OpcRelationshipError(
      'unresolvable-target',
      'Cannot resolve target',
      '/word/_rels/document.xml.rels',
      'rId1',
      { cause: underlying },
    );
    expect(relErr.cause).toBe(underlying);
  });
});
