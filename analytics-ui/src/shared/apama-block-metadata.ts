/**
 * Best-effort, client-side re-implementation of the Apama Analytics Builder
 * block SDK's "build metadata" step: parses the doc-comment/`@$...`
 * annotation convention documented in the block SDK guide
 * (https://github.com/Cumulocity-IoT/apama-analytics-builder-block-sdk/blob/main/doc/020-NamingAndDoc.md
 * and .../doc/100-InputAndOutput.md) directly out of a `.mon` file's source
 * text, and emits the same `files/events/<name>_metadata.evt` /
 * `_messages.evt` MonitorScript literals a real CLI build produces.
 *
 * Without these files, the correlator has no `BlockMetadata`/`BlockMessages`
 * event to inject for the extension, so it never appears in the per-extension
 * metadata endpoint the UI reads (`getDeployedExtensionDetails`) — the
 * extension looks "not loaded" even though its `.mon` file is present and
 * valid (see extension-builder.service.ts's `buildExtensionZip`).
 *
 * Known limitations (documented rather than silently wrong):
 * - `@$derivedName`/`@$titleIsDerived`/`@$isPreviewBlock` and other less
 *   common tags aren't parsed — only what's needed to make a block show up
 *   correctly with its name/description/category/parameters/inputs/outputs.
 * - A block with no matching doc-comment/annotations at all (older blocks
 *   that pre-date this convention, e.g. this repo's `AsyncSignal.mon`) still
 *   gets a minimal metadata entry (name = block name, category = Utilities,
 *   empty description) so it's at least recognized as loaded.
 */

import { extractBraceBody, findApamaBlockNames } from './utils';

export interface ParsedBlockParameter {
  id: string;
  name: string;
  description: string;
  type: string;
  semanticType?: string;
}

export interface ParsedBlockInput {
  id: string;
  name: string;
  description: string;
  type: string;
}

export interface ParsedBlockOutput {
  id: string;
  name: string;
  description: string;
  type: string;
}

export interface ParsedBlockMetadata {
  id: string;
  name: string;
  description: string;
  extendedDescription?: string;
  category: string;
  blockType?: string;
  consumesInput?: true;
  producesOutput?: true;
  inputs: ParsedBlockInput[];
  outputs: ParsedBlockOutput[];
  parameters: ParsedBlockParameter[];
}

const FIELD_TYPE_PATTERN = '(?:any|float|integer|decimal|boolean|string|dictionary<[^>]*>|sequence<[^>]*>)';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ParsedDocComment {
  name: string;
  description: string;
  extendedDescription: string;
  /** Single-value tags, e.g. `@$blockCategory Input` — last occurrence wins. */
  tags: Record<string, string | true>;
  /** Repeatable `@$inputName <id> <name>` tags, in source order. */
  inputNames: Array<{ id: string; name: string }>;
  /** Repeatable `@param $input_<id> <description>` tags, in source order. */
  inputParams: Array<{ id: string; description: string }>;
}

/** Parses a `/** ... *\/` doc comment into title/description/annotations. */
function parseDocComment(comment: string): ParsedDocComment {
  const lines = comment
    .replace(/^\/\*\*/, '')
    .replace(/\*\/$/, '')
    .split('\n')
    .map(line => line.replace(/^\s*\*\s?/, '').trimEnd());

  const tags: Record<string, string | true> = {};
  const inputNames: Array<{ id: string; name: string }> = [];
  const inputParams: Array<{ id: string; description: string }> = [];
  const bodyLines: string[] = [];

  for (const line of lines) {
    const inputNameMatch = line.match(/^@\$inputName\s+(\w+)\s+(.*)$/);
    if (inputNameMatch) {
      inputNames.push({ id: inputNameMatch[1], name: inputNameMatch[2].trim().replace(/\.$/, '') });
      continue;
    }
    const inputParamMatch = line.match(/^@param\s+\$input_(\w+)\s+(.*)$/);
    if (inputParamMatch) {
      inputParams.push({ id: inputParamMatch[1], description: inputParamMatch[2].trim() });
      continue;
    }
    const tagMatch = line.match(/^@\$(\w+)(?:\s+(.*))?$/);
    if (tagMatch) {
      tags[tagMatch[1]] = tagMatch[2]?.trim() || true;
      continue;
    }
    if (/^@(param|return|private)\b/.test(line)) {
      continue;
    }
    bodyLines.push(line);
  }

  const paragraphs: string[] = [];
  let current: string[] = [];
  for (const line of bodyLines) {
    if (line.trim() === '') {
      if (current.length) {
        paragraphs.push(current.join(' ').trim());
        current = [];
      }
    } else {
      current.push(line.trim());
    }
  }
  if (current.length) paragraphs.push(current.join(' ').trim());

  return {
    name: (paragraphs[0] || '').replace(/\.$/, ''),
    description: paragraphs[1] || '',
    extendedDescription: paragraphs.slice(2).join('\n\n'),
    tags,
    inputNames,
    inputParams
  };
}

/**
 * Finds the doc comment immediately preceding `index` (only whitespace
 * between the comment's end and `index`), if any.
 *
 * Must scan comments left-to-right and pick the last qualifying one, not a
 * single greedy/lazy regex over `content.slice(0, index)`: a lazy pattern
 * anchored at the end still anchors its *start* at the first doc comment in
 * the whole preceding text (regex match-finding is leftmost-start, not
 * closest-to-index), so it would span from the very first doc comment in
 * the file all the way to the last one before `index`, as one "comment".
 */
function findPrecedingDocComment(content: string, index: number): string | null {
  const commentPattern = /\/\*\*[\s\S]*?\*\//g;
  let candidate: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = commentPattern.exec(content))) {
    const end = match.index + match[0].length;
    if (end > index) break;
    candidate = /^\s*$/.test(content.slice(end, index)) ? match[0] : null;
  }
  return candidate;
}

/** Removes nested `action ... { ... }` bodies, leaving only top-level field declarations. */
function stripActionBlocks(body: string): string {
  let result = body;
  let actionIndex = result.search(/\baction\b[^;{]*\{/);
  while (actionIndex !== -1) {
    const openIndex = result.indexOf('{', actionIndex);
    let depth = 0;
    let endIndex = -1;
    for (let i = openIndex; i < result.length; i++) {
      if (result[i] === '{') depth++;
      else if (result[i] === '}') {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }
    if (endIndex === -1) break; // unbalanced; bail out rather than loop forever
    result = result.slice(0, actionIndex) + result.slice(endIndex + 1);
    actionIndex = result.search(/\baction\b[^;{]*\{/);
  }
  return result;
}

function parseFields(body: string): Array<{ doc: ParsedDocComment | null; type: string; name: string }> {
  const fieldsOnly = stripActionBlocks(body);
  const pattern = new RegExp(`(${FIELD_TYPE_PATTERN})\\s+(\\w+)\\s*;`, 'g');
  const fields: Array<{ doc: ParsedDocComment | null; type: string; name: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(fieldsOnly))) {
    const docComment = findPrecedingDocComment(fieldsOnly, match.index);
    fields.push({
      doc: docComment ? parseDocComment(docComment) : null,
      type: match[1],
      name: match[2]
    });
  }
  return fields;
}

function parseParameters(content: string, blockName: string): ParsedBlockParameter[] {
  const paramsEventPattern = new RegExp(`\\bevent\\s+${escapeRegExp(blockName)}_\\$Parameters\\b`);
  const declMatch = paramsEventPattern.exec(content);
  if (!declMatch) return [];

  const body = extractBraceBody(content, declMatch.index);
  if (!body) return [];

  return parseFields(body).map(field => ({
    id: field.name,
    name: field.doc?.name || field.name,
    description: field.doc?.description || '',
    type: field.type,
    semanticType: typeof field.doc?.tags['semanticType'] === 'string' ? field.doc.tags['semanticType'] : undefined
  }));
}

/**
 * Splits a `$process` parameter list on top-level commas only, respecting
 * `<...>` generic nesting (e.g. `dictionary<string,any>`) so its internal
 * comma isn't mistaken for a parameter separator.
 */
function splitParameterList(paramList: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of paramList) {
    if (char === '<') depth++;
    else if (char === '>') depth--;
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts.map(part => part.trim()).filter(Boolean);
}

/**
 * Maps a `$process` parameter's raw EPL type to the metadata schema's type
 * vocabulary: an explicit `$INPUT_TYPE_<id>` constant wins when present
 * (mirrors `$OUTPUT_TYPE_<id>` — e.g. a "pulse"-typed input declared as
 * `boolean` in EPL), and the `Value`/`optional<Value>` wrapper type (used
 * for inputs that carry an arbitrary value alongside validity/timestamp)
 * maps to `"any"` rather than being passed through verbatim.
 */
function normalizeInputType(rawType: string, id: string, blockBody: string): string {
  const explicit = new RegExp(`constant\\s+string\\s+\\$INPUT_TYPE_${escapeRegExp(id)}\\s*:=\\s*"([^"]*)"`).exec(blockBody)?.[1];
  if (explicit) return explicit;
  if (rawType === 'Value' || rawType === 'optional<Value>') return 'any';
  return rawType;
}

/**
 * Parses a block's `$input_*` parameters off its `$process` action, per the
 * `@$inputName <id> <name>` / `@param $input_<id> <description>` convention
 * on that action's doc comment. Declaration order in the signature decides
 * display order, per the SDK guide.
 */
function parseInputs(blockBody: string): ParsedBlockInput[] {
  const processMatch = /\baction\s+\$process\s*\(([^)]*)\)/.exec(blockBody);
  if (!processMatch) return [];

  const docComment = findPrecedingDocComment(blockBody, processMatch.index);
  const doc = docComment ? parseDocComment(docComment) : null;

  const inputParams = splitParameterList(processMatch[1])
    .map(param => {
      const match = /^(.+?)\s+\$input_(\w+)$/.exec(param);
      return match ? { type: match[1].trim(), id: match[2] } : null;
    })
    .filter((param): param is { type: string; id: string } => param !== null);

  return inputParams.map(param => ({
    id: param.id,
    name: doc?.inputNames.find(entry => entry.id === param.id)?.name || param.id,
    description: doc?.inputParams.find(entry => entry.id === param.id)?.description || '',
    type: normalizeInputType(param.type, param.id, blockBody)
  }));
}

/**
 * Parses a block's `$setOutput_*` fields (each paired with a
 * `$OUTPUT_TYPE_<id>` constant) within its own event body.
 */
function parseOutputs(blockBody: string): ParsedBlockOutput[] {
  const outputPattern = /action<[^>]*>\s*\$setOutput_(\w+)\s*;/g;
  const typeFor = (id: string) =>
    new RegExp(`constant\\s+string\\s+\\$OUTPUT_TYPE_${escapeRegExp(id)}\\s*:=\\s*"([^"]*)"`).exec(blockBody)?.[1] || 'pulse';

  const outputs: ParsedBlockOutput[] = [];
  let match: RegExpExecArray | null;
  while ((match = outputPattern.exec(blockBody))) {
    const id = match[1];
    const docComment = findPrecedingDocComment(blockBody, match.index);
    const doc = docComment ? parseDocComment(docComment) : null;
    outputs.push({
      id,
      name: doc?.name || id,
      description: doc?.description || '',
      type: typeFor(id)
    });
  }
  return outputs;
}

/**
 * Parses every block a `.mon` file defines (per the `_$Parameters`
 * companion-event convention, matching `extractBlockFqns` in utils.ts) into
 * the same shape the correlator's `BlockMetadata` event expects.
 */
export function parseApamaBlockMetadata(content: string, packageName: string): ParsedBlockMetadata[] {
  const blockNames = findApamaBlockNames(content);
  if (blockNames.length === 0) return [];

  return blockNames.map(blockName => {
    const declPattern = new RegExp(`\\bevent\\s+${escapeRegExp(blockName)}\\s*\\{`);
    const declMatch = declPattern.exec(content);
    const docComment = declMatch ? findPrecedingDocComment(content, declMatch.index) : null;
    const doc = docComment ? parseDocComment(docComment) : null;
    // Scope input/output parsing to this block's own event body so a file
    // defining more than one block (e.g. a Send/Receive pair) doesn't leak
    // one block's $process/$setOutput_* into another's.
    const body = declMatch ? extractBraceBody(content, declMatch.index) : null;

    return {
      id: `${packageName}.${blockName}`,
      name: doc?.name || blockName,
      description: doc?.description || '',
      extendedDescription: doc?.extendedDescription || undefined,
      category: (typeof doc?.tags['blockCategory'] === 'string' && doc.tags['blockCategory']) || 'Utilities',
      blockType: typeof doc?.tags['blockType'] === 'string' ? doc.tags['blockType'] : undefined,
      consumesInput: doc?.tags['consumesInput'] === true ? true : undefined,
      producesOutput: doc?.tags['producesOutput'] === true ? true : undefined,
      inputs: body ? parseInputs(body) : [],
      outputs: body ? parseOutputs(body) : [],
      parameters: parseParameters(content, blockName)
    };
  });
}

function escapeForMonitorScriptString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Builds the `files/events/<name>_metadata.evt` content: a single
 * `BlockMetadata` injection event covering every block found across all of
 * the extension's `.mon` files, matching the format the correlator itself
 * writes when applying a CLI-built extension.
 */
export function buildBlockMetadataEvt(name: string, blocks: ParsedBlockMetadata[]): string {
  // The real SDK-built samples use a "<major>.x.y" version string tied to
  // the Apama release they were built against; blocks built at different
  // majors (26.x.y, 27.x.y) are seen coexisting loaded in the same tenant,
  // so this appears informational rather than enforced — a generic
  // placeholder is used here rather than guessing a specific version.
  const payload = { analytics: blocks, version: '1.x.y' };
  const escaped = escapeForMonitorScriptString(JSON.stringify(payload));
  return `\n"analyticsbuilder.metadata.requests",apama.analyticsbuilder.BlockMetadata("${name}", "EN", "${escaped}")\n`;
}

/**
 * Builds the `files/events/<name>_messages.evt` content: the localization
 * strings (`BlockMessages`) referenced by the corresponding metadata.
 */
export function buildBlockMessagesEvt(name: string, blocks: ParsedBlockMetadata[]): string {
  const messages: Record<string, string> = {};

  for (const block of blocks) {
    if (block.name) messages[`block_${block.id}_name`] = block.name;
    if (block.description) messages[`block_${block.id}_description`] = block.description;
    if (block.extendedDescription) messages[`block_${block.id}_extendedDescription`] = block.extendedDescription;

    for (const input of block.inputs) {
      if (input.name) messages[`block_${block.id}_inputs_${input.id}_name`] = input.name;
      if (input.description) messages[`block_${block.id}_inputs_${input.id}_description`] = input.description;
    }
    for (const output of block.outputs) {
      if (output.name) messages[`block_${block.id}_outputs_${output.id}_name`] = output.name;
      if (output.description) messages[`block_${block.id}_outputs_${output.id}_description`] = output.description;
    }
    for (const param of block.parameters) {
      if (param.name) messages[`block_${block.id}_parameters_${param.id}_name`] = param.name;
      if (param.description) messages[`block_${block.id}_parameters_${param.id}_description`] = param.description;
    }
  }

  const escaped = escapeForMonitorScriptString(JSON.stringify(messages));
  return `\n"analyticsbuilder.metadata.requests",apama.analyticsbuilder.BlockMessages("${name}", "EN", "${escaped}")\n`;
}
