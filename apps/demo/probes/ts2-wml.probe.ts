import { IdTable, createDocPos, resolveDocDefaults, parseStylesXml, parseThemeXml, parseSettingsXml } from '@ooxml/wml';
import { wmlReader, wmlWriter, createReadContext, createWriteContext } from '@ooxml/schema';
export function probeWml(): void { const t = new IdTable(); createDocPos(t.mint('paragraph'), 0); resolveDocDefaults(); parseStylesXml(''); parseThemeXml(''); parseSettingsXml(''); void wmlReader; void wmlWriter; void createReadContext; void createWriteContext; }
