import { CEP_Block } from "./analytics.model";

export function uuidCustom(): string {
  let id = Math.random().toString(36).slice(-6);
  return id;
}

export function removeFileExtension(name: string): string {
  let result = name.replace(/\.[^.]*$/, "");
  return result;
}

export function getFileExtension(name: string): string {
  const pattern = /\.([0-9a-z]+)(?:[\?#]|$)/i;
  let result = name.match(pattern);
  return result[0];
}

export function isCustomCEP_Block(block: CEP_Block): boolean {
  return (
    !block.id.startsWith("apama.analyticsbuilder.blocks") &&
    !block.id.startsWith("apama.analyticskit.blocks.core") &&
    !block.id.startsWith("apama.analyticskit.blocks.cumulocity")
  );
}