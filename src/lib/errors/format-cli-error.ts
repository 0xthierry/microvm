import { AppError } from "./app-error";

const stringifyUnknown = (value: unknown): string => {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

export const formatCliError = (error: unknown): string => {
  if (error instanceof AppError) {
    if (error.hint) {
      return `${error.message}\nhint: ${error.hint}`;
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return stringifyUnknown(error);
};
