/**
 * Schema Sanitizer
 * Cleans and transforms JSON schemas for Google Cloud Code PA / Antigravity API compatibility.
 *
 * Implements a robust multi-phase pipeline matching production antigravity-claude-proxy:
 * - Phase 1a: Convert $refs to description hints
 * - Phase 1b: Add enum hints to description
 * - Phase 1c: Add additionalProperties hints
 * - Phase 1d: Move constraints (minLength, pattern, min/max) to description
 * - Phase 2a: Merge allOf schemas
 * - Phase 2b: Flatten anyOf/oneOf (select best option by score)
 * - Phase 2c: Flatten type arrays (e.g. ["string", "null"]) + update required for nullable
 * - Phase 3: Allowlist & convert "const" to "enum", strip all unsupported keys (exclusiveMinimum, uniqueItems, etc.)
 * - Phase 4: Final cleanup, nested recursion & required array validation
 * - Phase 5: Convert types to Google Protobuf uppercase (STRING, NUMBER, INTEGER, BOOLEAN, ARRAY, OBJECT)
 * - Phase 6: Ensure ARRAY has a valid single object `items` schema
 * - Phase 7: Strip properties/required from non-OBJECT types
 */

function appendDescriptionHint(schema: any, hint: string): any {
  if (!schema || typeof schema !== 'object') return schema;
  const result = { ...schema };
  result.description = result.description
    ? `${result.description} (${hint})`
    : hint;
  return result;
}

function scoreSchemaOption(schema: any): number {
  if (!schema || typeof schema !== 'object') return 0;
  if (schema.type === 'object' || schema.properties) return 3;
  if (schema.type === 'array' || schema.items) return 2;
  if (schema.type && schema.type !== 'null') return 1;
  return 0;
}

function convertRefsToHints(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(convertRefsToHints);

  const result = { ...schema };

  if (result.$ref && typeof result.$ref === 'string') {
    const parts = result.$ref.split('/');
    const defName = parts[parts.length - 1] || 'unknown';
    const hint = `See: ${defName}`;
    const description = result.description
      ? `${result.description} (${hint})`
      : hint;
    return { type: 'object', description };
  }

  if (result.properties && typeof result.properties === 'object') {
    result.properties = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      result.properties[key] = convertRefsToHints(value);
    }
  }

  if (result.items) {
    if (Array.isArray(result.items)) {
      result.items = result.items.map(convertRefsToHints);
    } else if (typeof result.items === 'object') {
      result.items = convertRefsToHints(result.items);
    }
  }

  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(result[key])) {
      result[key] = result[key].map(convertRefsToHints);
    }
  }

  return result;
}

function mergeAllOf(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(mergeAllOf);

  let result = { ...schema };

  if (Array.isArray(result.allOf) && result.allOf.length > 0) {
    const mergedProperties: Record<string, any> = {};
    const mergedRequired = new Set<string>();
    const otherFields: Record<string, any> = {};

    for (const subSchema of result.allOf) {
      if (!subSchema || typeof subSchema !== 'object') continue;

      if (subSchema.properties) {
        for (const [key, value] of Object.entries(subSchema.properties)) {
          mergedProperties[key] = value;
        }
      }

      if (Array.isArray(subSchema.required)) {
        for (const req of subSchema.required) {
          mergedRequired.add(req);
        }
      }

      for (const [key, value] of Object.entries(subSchema)) {
        if (key !== 'properties' && key !== 'required' && !(key in otherFields)) {
          otherFields[key] = value;
        }
      }
    }

    delete result.allOf;

    for (const [key, value] of Object.entries(otherFields)) {
      if (!(key in result)) {
        result[key] = value;
      }
    }

    if (Object.keys(mergedProperties).length > 0) {
      result.properties = { ...mergedProperties, ...(result.properties || {}) };
    }

    if (mergedRequired.size > 0) {
      const parentRequired = Array.isArray(result.required) ? result.required : [];
      result.required = [...new Set([...mergedRequired, ...parentRequired])];
    }
  }

  if (result.properties && typeof result.properties === 'object') {
    const newProps: Record<string, any> = {};
    for (const [key, value] of Object.entries(result.properties)) {
      newProps[key] = mergeAllOf(value);
    }
    result.properties = newProps;
  }

  if (result.items) {
    if (Array.isArray(result.items)) {
      result.items = result.items.map(mergeAllOf);
    } else if (typeof result.items === 'object') {
      result.items = mergeAllOf(result.items);
    }
  }

  return result;
}

function flattenAnyOfOneOf(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(flattenAnyOfOneOf);

  let result = { ...schema };

  for (const unionKey of ['anyOf', 'oneOf']) {
    if (Array.isArray(result[unionKey]) && result[unionKey].length > 0) {
      const options = result[unionKey];
      const typeNames: string[] = [];
      let bestOption: any = null;
      let bestScore = -1;

      for (const option of options) {
        if (!option || typeof option !== 'object') continue;
        const typeName = option.type || (option.properties ? 'object' : null);
        if (typeName && typeName !== 'null') {
          typeNames.push(String(typeName));
        }

        const score = scoreSchemaOption(option);
        if (score > bestScore) {
          bestScore = score;
          bestOption = option;
        }
      }

      delete result[unionKey];

      if (bestOption) {
        const parentDescription = result.description;
        const flattenedOption = flattenAnyOfOneOf(bestOption);

        for (const [key, value] of Object.entries(flattenedOption)) {
          if (key === 'description') {
            if (value && value !== parentDescription) {
              result.description = parentDescription
                ? `${parentDescription} (${value})`
                : value;
            }
          } else if (!(key in result) || key === 'type' || key === 'properties' || key === 'items') {
            result[key] = value;
          }
        }

        if (typeNames.length > 1) {
          const uniqueTypes = [...new Set(typeNames)];
          result = appendDescriptionHint(result, `Accepts: ${uniqueTypes.join(' | ')}`);
        }
      }
    }
  }

  if (result.properties && typeof result.properties === 'object') {
    const newProps: Record<string, any> = {};
    for (const [key, value] of Object.entries(result.properties)) {
      newProps[key] = flattenAnyOfOneOf(value);
    }
    result.properties = newProps;
  }

  if (result.items) {
    if (Array.isArray(result.items)) {
      result.items = result.items.map(flattenAnyOfOneOf);
    } else if (typeof result.items === 'object') {
      result.items = flattenAnyOfOneOf(result.items);
    }
  }

  return result;
}

function addEnumHints(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(addEnumHints);

  let result = { ...schema };

  if (Array.isArray(result.enum) && result.enum.length > 1 && result.enum.length <= 10) {
    const vals = result.enum.map((v: any) => String(v)).join(', ');
    result = appendDescriptionHint(result, `Allowed: ${vals}`);
  }

  if (result.properties && typeof result.properties === 'object') {
    const newProps: Record<string, any> = {};
    for (const [key, value] of Object.entries(result.properties)) {
      newProps[key] = addEnumHints(value);
    }
    result.properties = newProps;
  }

  if (result.items) {
    result.items = Array.isArray(result.items)
      ? result.items.map(addEnumHints)
      : addEnumHints(result.items);
  }

  return result;
}

function addAdditionalPropertiesHints(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(addAdditionalPropertiesHints);

  let result = { ...schema };

  if (result.additionalProperties === false) {
    result = appendDescriptionHint(result, 'No extra properties allowed');
  }

  if (result.properties && typeof result.properties === 'object') {
    const newProps: Record<string, any> = {};
    for (const [key, value] of Object.entries(result.properties)) {
      newProps[key] = addAdditionalPropertiesHints(value);
    }
    result.properties = newProps;
  }

  if (result.items) {
    result.items = Array.isArray(result.items)
      ? result.items.map(addAdditionalPropertiesHints)
      : addAdditionalPropertiesHints(result.items);
  }

  return result;
}

function moveConstraintsToDescription(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(moveConstraintsToDescription);

  const CONSTRAINTS = [
    'minLength', 'maxLength', 'pattern', 'minimum', 'maximum',
    'exclusiveMinimum', 'exclusiveMaximum', 'minItems', 'maxItems',
    'uniqueItems', 'format'
  ];

  let result = { ...schema };

  for (const constraint of CONSTRAINTS) {
    if (result[constraint] !== undefined && typeof result[constraint] !== 'object') {
      result = appendDescriptionHint(result, `${constraint}: ${result[constraint]}`);
    }
  }

  if (result.properties && typeof result.properties === 'object') {
    const newProps: Record<string, any> = {};
    for (const [key, value] of Object.entries(result.properties)) {
      newProps[key] = moveConstraintsToDescription(value);
    }
    result.properties = newProps;
  }

  if (result.items) {
    result.items = Array.isArray(result.items)
      ? result.items.map(moveConstraintsToDescription)
      : moveConstraintsToDescription(result.items);
  }

  return result;
}

function flattenTypeArrays(schema: any, nullableProps: Set<string> | null = null, currentPropName: string | null = null): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(s => flattenTypeArrays(s, nullableProps));

  let result = { ...schema };

  if (Array.isArray(result.type)) {
    const types: string[] = result.type;
    const hasNull = types.includes('null');
    const nonNullTypes = types.filter(t => t !== 'null' && t);

    const firstType = nonNullTypes.length > 0 ? nonNullTypes[0] : 'string';
    result.type = firstType;

    if (nonNullTypes.length > 1) {
      result = appendDescriptionHint(result, `Accepts: ${nonNullTypes.join(' | ')}`);
    }

    if (hasNull) {
      result = appendDescriptionHint(result, 'nullable');
      if (nullableProps && currentPropName) {
        nullableProps.add(currentPropName);
      }
    }
  }

  if (result.properties && typeof result.properties === 'object') {
    const childNullableProps = new Set<string>();
    const newProps: Record<string, any> = {};

    for (const [key, value] of Object.entries(result.properties)) {
      newProps[key] = flattenTypeArrays(value, childNullableProps, key);
    }
    result.properties = newProps;

    if (Array.isArray(result.required) && childNullableProps.size > 0) {
      result.required = result.required.filter((prop: string) => !childNullableProps.has(prop));
      if (result.required.length === 0) {
        delete result.required;
      }
    }
  }

  if (result.items) {
    if (Array.isArray(result.items)) {
      result.items = result.items.map((item: any) => flattenTypeArrays(item, nullableProps));
    } else if (typeof result.items === 'object') {
      result.items = flattenTypeArrays(result.items, nullableProps);
    }
  }

  return result;
}

function toGoogleType(type: string): string {
  if (!type || typeof type !== 'string') return type;
  const typeMap: Record<string, string> = {
    'string': 'STRING',
    'number': 'NUMBER',
    'integer': 'INTEGER',
    'boolean': 'BOOLEAN',
    'array': 'ARRAY',
    'object': 'OBJECT',
    'null': 'STRING'
  };
  return typeMap[type.toLowerCase()] || type.toUpperCase();
}

/**
 * Clean and transform schema using allowlist and comprehensive keyword stripping
 */
export function sanitizeSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') {
    return {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          description: 'Reason for calling this tool'
        }
      },
      required: ['reason']
    };
  }

  const ALLOWED_FIELDS = new Set([
    'type',
    'description',
    'properties',
    'required',
    'items',
    'enum',
    'title'
  ]);

  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(schema)) {
    // Convert "const" to "enum" for compatibility
    if (key === 'const') {
      sanitized.enum = [value];
      continue;
    }

    if (!ALLOWED_FIELDS.has(key)) {
      continue;
    }

    if (key === 'properties' && value && typeof value === 'object') {
      sanitized.properties = {};
      for (const [propKey, propValue] of Object.entries(value as Record<string, any>)) {
        sanitized.properties[propKey] = sanitizeSchema(propValue);
      }
    } else if (key === 'items' && value && typeof value === 'object') {
      if (Array.isArray(value)) {
        sanitized.items = value.map(item => sanitizeSchema(item));
      } else {
        sanitized.items = sanitizeSchema(value);
      }
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeSchema(value);
    } else {
      sanitized[key] = value;
    }
  }

  if (!sanitized.type) {
    sanitized.type = 'OBJECT';
  }

  if (sanitized.type === 'OBJECT' && (!sanitized.properties || Object.keys(sanitized.properties).length === 0)) {
    sanitized.properties = {
      reason: {
        type: 'STRING',
        description: 'Reason for calling this tool'
      }
    };
    sanitized.required = ['reason'];
  }

  return sanitized;
}

/**
 * Cleans JSON schema for Gemini / Google Cloud Code API compatibility.
 */
export function cleanSchema(schema: any): any {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(cleanSchema);

  // Phase 1a: Convert $refs to hints
  let result = convertRefsToHints(schema);

  // Phase 1b: Add enum hints (preserves enum info in description)
  result = addEnumHints(result);

  // Phase 1c: Add additionalProperties hints
  result = addAdditionalPropertiesHints(result);

  // Phase 1d: Move constraints to description
  result = moveConstraintsToDescription(result);

  // Phase 2a: Merge allOf schemas
  result = mergeAllOf(result);

  // Phase 2b: Flatten anyOf/oneOf
  result = flattenAnyOfOneOf(result);

  // Phase 2c: Flatten type arrays and update required for nullable
  result = flattenTypeArrays(result);

  // Convert const to enum before stripping
  if (result.const !== undefined) {
    if (!result.enum) {
      result.enum = [result.const];
    }
    delete result.const;
  }

  // Phase 3: Remove unsupported keywords
  const unsupported = [
    'additionalProperties', 'default', '$schema', '$defs',
    'definitions', '$ref', '$id', '$comment', 'title',
    'minLength', 'maxLength', 'pattern', 'format',
    'minItems', 'maxItems', 'examples', 'allOf', 'anyOf', 'oneOf',
    'const', 'exclusiveMinimum', 'exclusiveMaximum', 'uniqueItems',
    'propertyNames', 'patternProperties', 'dependencies'
  ];

  const unsupportedSet = new Set(unsupported);

  for (const key of unsupported) {
    delete result[key];
  }

  // Check for unsupported 'format' in string types
  if (result.type === 'string' && result.format) {
    const allowed = ['enum', 'date-time'];
    if (!allowed.includes(result.format)) {
      delete result.format;
    }
  }

  const SCHEMA_META_KEYWORDS = new Set([
    '$defs', 'definitions', '$schema', '$id', '$ref', '$comment'
  ]);

  // Phase 4: Final cleanup - recursively clean nested schemas and validate required
  if (result.properties && typeof result.properties === 'object') {
    const newProps: Record<string, any> = {};
    for (const [key, value] of Object.entries(result.properties)) {
      if (SCHEMA_META_KEYWORDS.has(key)) {
        continue;
      }
      newProps[key] = cleanSchema(value);
    }
    result.properties = newProps;
  }

  if (result.items) {
    if (Array.isArray(result.items)) {
      result.items = result.items.map(cleanSchema);
    } else if (typeof result.items === 'object') {
      result.items = cleanSchema(result.items);
    }
  }

  if (result.required && Array.isArray(result.required) && result.properties) {
    const definedProps = new Set(Object.keys(result.properties));
    result.required = result.required.filter((prop: string) => definedProps.has(prop));
    if (result.required.length === 0) {
      delete result.required;
    }
  }

  // Phase 5: Convert type to Google's uppercase format
  if (result.type && typeof result.type === 'string') {
    result.type = toGoogleType(result.type);
  }

  // Phase 6: Ensure ARRAY has a valid single items schema
  if (result.type === 'ARRAY') {
    if (!result.items || typeof result.items !== 'object') {
      result.items = { type: 'STRING' };
    } else if (Array.isArray(result.items)) {
      let best: any = null;
      let bestScore = -1;
      for (const option of result.items) {
        const score = scoreSchemaOption(option);
        if (score > bestScore) {
          bestScore = score;
          best = option;
        }
      }
      result.items = best || { type: 'STRING' };
    }
  }

  // Phase 7: Strip properties/required from non-OBJECT types
  if (result.type !== 'OBJECT') {
    delete result.properties;
    delete result.required;
  }

  return result;
}

/**
 * Public export matching interface: sanitizeGoogleSchema
 */
export function sanitizeGoogleSchema(schema: any): any {
  if (!schema || typeof schema !== 'object' || Object.keys(schema).length === 0) {
    return {
      type: 'OBJECT',
      properties: {
        reason: {
          type: 'STRING',
          description: 'Reason for calling this tool'
        }
      },
      required: ['reason']
    };
  }

  const cleaned = cleanSchema(schema);

  // If object type with no properties, add placeholder to prevent Google PA rejection
  if (cleaned.type === 'OBJECT' && (!cleaned.properties || Object.keys(cleaned.properties).length === 0)) {
    cleaned.properties = {
      reason: {
        type: 'STRING',
        description: 'Reason for calling this tool'
      }
    };
    cleaned.required = ['reason'];
  }

  return cleaned;
}
