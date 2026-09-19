export interface FieldSwitch {
  readonly letter: string;
  readonly argument?: string | undefined;
  readonly raw: string;
  readonly known: boolean;
}

export interface FieldInstruction {
  readonly name: string;
  readonly arguments: readonly string[];
  readonly switches: readonly FieldSwitch[];
  readonly raw: string;
}

const KNOWN_SWITCHES = new Set(['*', '#', '@', '!']);

/** Parses a field instruction without discarding unknown switches. */
export function parseFieldInstruction(raw: string): FieldInstruction {
  const tokens: string[] = [];
  let token = '';
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === '\\' && quoted && raw[i + 1] === '"') {
      token += '"';
      i += 1;
      continue;
    }
    if (/\s/.test(char) && !quoted) {
      if (token.length > 0) tokens.push(token);
      token = '';
    } else {
      token += char;
    }
  }
  if (token.length > 0) tokens.push(token);
  const name = (tokens.shift() ?? '').toUpperCase();
  const args: string[] = [];
  const switches: FieldSwitch[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const value = tokens[i]!;
    if (!value.startsWith('\\') || value.length < 2) {
      args.push(value);
      continue;
    }
    const letter = value.slice(1);
    const argument = tokens[i + 1];
    const takesArgument = argument !== undefined && !argument.startsWith('\\');
    if (takesArgument) i += 1;
    switches.push({
      letter,
      ...(takesArgument ? { argument } : {}),
      raw: `\\${letter}${takesArgument ? ` ${argument}` : ''}`,
      known: KNOWN_SWITCHES.has(letter),
    });
  }
  return { name, arguments: args, switches, raw };
}
