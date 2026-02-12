import { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";

interface ApiError {
  error: {
    type: string;
    code: string;
    message: string;
    param?: string;
    doc_url?: string;
  };
}

export const errorHandler: ErrorHandler = (err, c) => {
  console.error(`[ERROR] ${err.message}`, err.stack);

  // Handle HTTPException (our thrown errors)
  if (err instanceof HTTPException) {
    const status = err.status;
    const message = err.message;

    const errorResponse: ApiError = {
      error: {
        type: getErrorType(status),
        code: getErrorCode(status, message),
        message,
      },
    };

    return c.json(errorResponse, status);
  }

  // Handle Prisma errors
  if (err.constructor.name === "PrismaClientKnownRequestError") {
    const prismaErr = err as any;
    
    if (prismaErr.code === "P2002") {
      return c.json(
        {
          error: {
            type: "invalid_request_error",
            code: "resource_already_exists",
            message: "A resource with this identifier already exists.",
            param: prismaErr.meta?.target?.[0],
          },
        },
        409
      );
    }

    if (prismaErr.code === "P2025") {
      return c.json(
        {
          error: {
            type: "invalid_request_error",
            code: "resource_not_found",
            message: "The requested resource was not found.",
          },
        },
        404
      );
    }
  }

  // Handle validation errors
  if (err.name === "ValidationError") {
    return c.json(
      {
        error: {
          type: "invalid_request_error",
          code: "validation_error",
          message: err.message,
        },
      },
      400
    );
  }

  // Generic server error
  return c.json(
    {
      error: {
        type: "api_error",
        code: "internal_error",
        message: process.env.NODE_ENV === "production" 
          ? "An unexpected error occurred. Please try again later."
          : err.message,
      },
    },
    500
  );
};

function getErrorType(status: number): string {
  if (status === 401) return "authentication_error";
  if (status === 403) return "permission_error";
  if (status === 404) return "invalid_request_error";
  if (status === 429) return "rate_limit_error";
  if (status >= 400 && status < 500) return "invalid_request_error";
  return "api_error";
}

function getErrorCode(status: number, message: string): string {
  if (status === 401) return "authentication_required";
  if (status === 403) return "permission_denied";
  if (status === 404) return "resource_not_found";
  if (status === 429) return "rate_limit_exceeded";
  
  // Try to extract a code from the message
  const codeMatch = message.toLowerCase().match(/^(\w+):/);
  if (codeMatch) return codeMatch[1];
  
  return "invalid_request";
}
