import {
  DEFAULT_OPC_LIMITS,
  OpcError,
  OpcEncryptedPackageError,
  openPackage,
  type CoreProperties,
  type CustomProperty,
  type ExtendedProperties,
  type OpcPackage,
  savePackage,
} from '@ooxml/opc';
import { createCursor, createStringSink } from '@ooxml/schema';
import { createBlankDocument } from '../fixtures/blank-doc.js';

const XML_SUPPORT = { createCursor, createStringSink };

export interface DocumentProperties {
  readonly core: CoreProperties | undefined;
  readonly extended: ExtendedProperties | undefined;
  readonly custom: readonly CustomProperty[] | undefined;
}

export type AppAlert = (message: string) => void;

/** Browser-independent package state; DOM download behavior is kept in downloadFile. */
export class AppState {
  private packageValue: OpcPackage | undefined;
  private bytesValue: Uint8Array;
  private fileNameValue = 'Untitled.docx';
  private readonly alert: AppAlert;

  constructor(options: { readonly alert?: AppAlert; readonly fileName?: string } = {}) {
    this.bytesValue = createBlankDocument();
    this.alert = options.alert ?? ((message) => {
      if (typeof window !== 'undefined' && typeof window.alert === 'function') window.alert(message);
    });
    if (options.fileName !== undefined) this.fileNameValue = options.fileName;
  }

  get package(): OpcPackage | undefined { return this.packageValue; }
  get fileName(): string { return this.fileNameValue; }
  get properties(): DocumentProperties | undefined {
    const pkg = this.packageValue;
    return pkg === undefined ? undefined : {
      core: pkg.coreProperties(),
      extended: pkg.extendedProperties(),
      custom: pkg.customProperties(),
    };
  }

  async openFile(file: File): Promise<void> {
    try {
      const input = new Uint8Array(await file.arrayBuffer());
      const opened = await openPackage(input, XML_SUPPORT, DEFAULT_OPC_LIMITS);
      // Commit only after every package-open step succeeds, so a failed upload
      // cannot destroy the currently displayed document.
      this.packageValue = opened;
      this.bytesValue = input;
      this.fileNameValue = file.name || this.fileNameValue;
    } catch (error: unknown) {
      this.alert(messageForOpenError(error));
    }
  }

  async saveFile(): Promise<Uint8Array> {
    try {
      if (this.packageValue === undefined) {
        this.packageValue = await openPackage(this.bytesValue, XML_SUPPORT, DEFAULT_OPC_LIMITS);
      }
      const saved = await savePackage(this.packageValue, {
        onWarning: (warning) => this.alert(warning.message),
      });
      this.bytesValue = saved;
      return saved;
    } catch (error: unknown) {
      this.alert(messageForOpenError(error));
      throw error;
    }
  }

  downloadFile(): void {
    if (typeof document === 'undefined' || typeof URL === 'undefined') {
      this.alert('Downloading a document requires a browser.');
      return;
    }
    void this.saveFile().then((bytes) => {
      // Copy into a concrete ArrayBuffer because DOM BlobPart typings reject
      // SharedArrayBuffer-capable Uint8Array views under strict TS settings.
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const url = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = this.fileNameValue;
      anchor.click();
      // Revoke after the click has been dispatched; retaining object URLs leaks
      // the complete document for every download in a long-lived editor tab.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }).catch(() => undefined);
  }
}

function messageForOpenError(error: unknown): string {
  if (error instanceof OpcEncryptedPackageError || (error instanceof OpcError && error.kind === 'encrypted')) {
    return 'This document is password-protected or encrypted and cannot be opened.';
  }
  if (error instanceof OpcError && error.kind === 'limit') return `The document exceeds a safety limit: ${error.message}`;
  if (error instanceof OpcError) return `The document could not be opened: ${error.message}`;
  return 'The document could not be opened because it is not a valid .docx package.';
}
