import { openPackage, savePackage, DEFAULT_OPC_LIMITS, validatePartName, type OpcPackage, type XmlSupport } from '@ooxml/opc';
import { createCursor, createStringSink } from '@ooxml/schema';
export function probeOpc(pkg: OpcPackage, support: XmlSupport): Promise<Uint8Array> { void support; void createCursor; void createStringSink; void DEFAULT_OPC_LIMITS; void validatePartName('/word/document.xml'); void openPackage; return savePackage(pkg); }
