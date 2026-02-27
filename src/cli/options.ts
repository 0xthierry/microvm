import { InvalidArgumentError } from "commander";

type InputValidationErrorFactory = (message: string) => Error;

export type BooleanOptionValue = string | boolean | undefined;

export const readStringOption = (
  value: string | undefined,
  key: string,
  createError: InputValidationErrorFactory,
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw createError(`Flag --${key} cannot be empty.`);
  }

  return trimmed;
};

export const parseBooleanOption = (
  value: BooleanOptionValue,
  key: string,
  createError: InputValidationErrorFactory,
): boolean => {
  if (value === undefined) {
    return false;
  }

  if (typeof value === "boolean") {
    return value;
  }

  const normalized = value.toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes") {
    return true;
  }

  if (normalized === "0" || normalized === "false" || normalized === "no") {
    return false;
  }

  throw createError(`Flag --${key} expects a boolean value (true/false).`);
};

export const parsePositiveIntegerOption = (flagName: string) => (value: string): number => {
  if (!/^\d+$/.test(value)) {
    throw new InvalidArgumentError(
      `Flag --${flagName} expects a positive integer, got "${value}".`,
    );
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(
      `Flag --${flagName} expects a positive integer, got "${value}".`,
    );
  }

  return parsed;
};
