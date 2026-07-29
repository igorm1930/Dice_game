import {
  type ArgumentMetadata,
  Body,
  Injectable,
  Param,
  type PipeTransform,
  Query,
} from '@nestjs/common';
import { z, ZodError, ZodType, type ZodTypeAny } from 'zod';

import { ValidationError } from '../errors/api-error';

/**
 * Validates requests against the contract's own Zod schemas.
 *
 * The schemas in `@dice-game/contracts` are the single source of truth for the
 * wire, so the API validates with the same declarations the client builds its
 * forms from. Nothing is hand-written twice, and a field cannot drift on one
 * side without failing the build on the other.
 *
 * Two ways to use it, both ending in a `VALIDATION_ERROR` with per-field detail:
 *
 * ```ts
 * // Explicit, per parameter — the usual case.
 * login(@Body(new ZodValidationPipe(loginRequestSchema)) body: LoginRequest) {}
 * login(@ZodBody(loginRequestSchema) body: LoginRequest) {}
 *
 * // Or via a schema-carrying DTO class, picked up by the global pipe.
 * class LoginDto extends createZodDto(loginRequestSchema) {}
 * login(@Body() body: LoginDto) {}
 * ```
 *
 * Constructed without a schema — as the globally registered instance is — it
 * validates only parameters whose type is such a DTO and passes everything else
 * through untouched. It never guesses.
 *
 * The parsed *output* is returned, not the input: Zod's `trim`, `toLowerCase`
 * and coercions are part of the contract, so a handler receives the normalised
 * value (a lower-cased email, a numeric `limit`) rather than the raw one.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform<unknown, unknown> {
  constructor(private readonly schema?: ZodTypeAny) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    const schema = this.schema ?? schemaOf(metadata.metatype);

    if (schema === null) {
      return value;
    }

    const result = schema.safeParse(value);

    if (!result.success) {
      throw new ValidationError(describe(result.error, metadata));
    }

    return result.data;
  }
}

/**
 * Field-level detail for the client.
 *
 * Only the path and the machine-readable code are returned.
 *
 * Zod's own `message` is deliberately dropped: for `unrecognized_keys` and
 * `invalid_enum_value` it embeds the submitted input, so a request that put a
 * secret in the wrong field would have it echoed back in the error body. The
 * path says which field was wrong and the code says why, which is everything a
 * client needs and nothing an attacker learns from.
 */
function describe(error: ZodError, metadata: ArgumentMetadata): Readonly<Record<string, unknown>> {
  return {
    target: metadata.type,
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
    })),
  };
}

/** A class that carries the schema its instances must satisfy. */
export interface ZodDto<TOutput> {
  new (): TOutput;
  readonly schema: ZodTypeAny;
}

/**
 * Turns a contract schema into a DTO class.
 *
 * The class exists only to be a `metatype` the global pipe can recognise —
 * Nest's parameter metadata carries the declared type, and a bare interface
 * leaves nothing behind at runtime.
 */
export function createZodDto<TSchema extends ZodTypeAny>(
  schema: TSchema,
): ZodDto<z.infer<TSchema>> {
  class SchemaCarrier {
    static readonly schema = schema;

    /**
     * Never emitted — `declare` produces no runtime field. It exists so the
     * class is not "static members only", which is the shape that usually
     * signals a namespace masquerading as a class. Here the class *is* the
     * runtime artefact: Nest reads it out of `design:paramtypes`.
     */
    declare readonly parsed: z.infer<TSchema>;
  }

  return SchemaCarrier;
}

function schemaOf(metatype: ArgumentMetadata['metatype']): ZodTypeAny | null {
  if (typeof metatype !== 'function' || !Object.hasOwn(metatype, 'schema')) {
    return null;
  }

  const schema: unknown = (metatype as { schema?: unknown }).schema;

  return schema instanceof ZodType ? schema : null;
}

/** `@Body()` validated against a contract schema. */
export const ZodBody = (schema: ZodTypeAny): ParameterDecorator =>
  Body(new ZodValidationPipe(schema));

/** `@Param()` validated against a contract schema. */
export const ZodParam = (schema: ZodTypeAny): ParameterDecorator =>
  Param(new ZodValidationPipe(schema));

/** `@Query()` validated against a contract schema. */
export const ZodQuery = (schema: ZodTypeAny): ParameterDecorator =>
  Query(new ZodValidationPipe(schema));
