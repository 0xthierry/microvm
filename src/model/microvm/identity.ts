import { randomBytes } from "node:crypto";
import { AppError } from "../../lib/errors/app-error";

const VM_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const VM_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const JAILER_SAFE_VM_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_SIZE = 8;
const ACCEPTED_BYTE_MAX = Math.floor(256 / ID_ALPHABET.length) * ID_ALPHABET.length;

export class VmNameInvalidError extends AppError {
  constructor(name: string) {
    super(`Invalid VM name "${name}". Use lowercase letters, digits, '_' and '-' (max 32 chars).`);
  }
}

export class VmIdInvalidError extends AppError {
  constructor(vmId: string) {
    super(`Invalid vm-id "${vmId}". Use lowercase letters, digits, '_' and '-' (max 32 chars).`);
  }
}

export class VmIdNotJailerSafeError extends AppError {
  constructor(vmId: string) {
    super(`VM id "${vmId}" is not jailer-safe. Use lowercase letters, digits and '-' only.`);
  }
}

export const assertVmName = (name: string): void => {
  if (!VM_NAME_PATTERN.test(name)) {
    throw new VmNameInvalidError(name);
  }
};

export const assertVmId = (vmId: string): void => {
  if (!VM_ID_PATTERN.test(vmId)) {
    throw new VmIdInvalidError(vmId);
  }
};

export const assertJailerSafeVmId = (vmId: string): void => {
  if (!JAILER_SAFE_VM_ID_PATTERN.test(vmId)) {
    throw new VmIdNotJailerSafeError(vmId);
  }
};

export const generateVmId = (): string => {
  let result = "";
  while (result.length < ID_SIZE) {
    const bytes = randomBytes(ID_SIZE);
    for (const byte of bytes) {
      if (byte >= ACCEPTED_BYTE_MAX) {
        continue;
      }

      const char = ID_ALPHABET[byte % ID_ALPHABET.length];
      if (!char) {
        continue;
      }

      result += char;
      if (result.length === ID_SIZE) {
        break;
      }
    }
  }

  assertVmId(result);
  assertJailerSafeVmId(result);
  return result;
};
