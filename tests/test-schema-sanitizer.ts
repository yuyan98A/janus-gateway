import assert from 'node:assert';
import { sanitizeGoogleSchema } from '../src/providers/google/schema-sanitizer.ts';

console.log('='.repeat(70));
console.log('🧪 Starting Google Schema Sanitizer Multi-Phase Pipeline Tests');
console.log('='.repeat(70));

// Test 1: Const to Enum conversion & stripping
console.log('• Testing "const" conversion to enum and stripping...');
const constSchema = {
  type: 'object',
  properties: {
    command: {
      type: 'string',
      const: 'git'
    }
  }
};
const cleanedConst = sanitizeGoogleSchema(constSchema);
assert.strictEqual(cleanedConst.type, 'OBJECT');
assert.strictEqual(cleanedConst.properties.command.type, 'STRING');
assert.deepStrictEqual(cleanedConst.properties.command.enum, ['git']);
assert.strictEqual(cleanedConst.properties.command.const, undefined);
console.log('  PASSED');

// Test 2: exclusiveMinimum & uniqueItems stripping
console.log('• Testing "exclusiveMinimum" & "uniqueItems" removal...');
const constraintSchema = {
  type: 'object',
  properties: {
    count: {
      type: 'integer',
      exclusiveMinimum: 0,
      exclusiveMaximum: 100
    },
    tags: {
      type: 'array',
      uniqueItems: true,
      items: { type: 'string' }
    }
  }
};
const cleanedConstraints = sanitizeGoogleSchema(constraintSchema);
assert.strictEqual(cleanedConstraints.properties.count.exclusiveMinimum, undefined);
assert.strictEqual(cleanedConstraints.properties.count.exclusiveMaximum, undefined);
assert.strictEqual(cleanedConstraints.properties.tags.uniqueItems, undefined);
assert.strictEqual(cleanedConstraints.properties.tags.type, 'ARRAY');
assert.strictEqual(cleanedConstraints.properties.tags.items.type, 'STRING');
console.log('  PASSED');

// Test 3: type arrays like ["string", "null"] (Proto field is not repeating, cannot start list)
console.log('• Testing type array flattening e.g. ["string", "null"]...');
const typeArraySchema = {
  type: 'object',
  properties: {
    nullableStr: {
      type: ['string', 'null'],
      description: 'A nullable string'
    },
    nullableNum: {
      type: ['number', 'null']
    }
  },
  required: ['nullableStr']
};
const cleanedTypeArray = sanitizeGoogleSchema(typeArraySchema);
assert.strictEqual(typeof cleanedTypeArray.properties.nullableStr.type, 'string');
assert.strictEqual(cleanedTypeArray.properties.nullableStr.type, 'STRING');
assert.strictEqual(cleanedTypeArray.properties.nullableNum.type, 'NUMBER');
// nullable should be removed from required array
assert.ok(!cleanedTypeArray.required || !cleanedTypeArray.required.includes('nullableStr'));
console.log('  PASSED');

// Test 4: anyOf and oneOf flattening
console.log('• Testing anyOf / oneOf flattening and description preservation...');
const unionSchema = {
  type: 'object',
  properties: {
    payload: {
      anyOf: [
        {
          type: 'object',
          properties: {
            text: { type: 'string' }
          }
        },
        {
          type: 'string'
        }
      ]
    }
  }
};
const cleanedUnion = sanitizeGoogleSchema(unionSchema);
assert.strictEqual(cleanedUnion.properties.payload.anyOf, undefined);
assert.strictEqual(cleanedUnion.properties.payload.oneOf, undefined);
assert.strictEqual(cleanedUnion.properties.payload.type, 'OBJECT');
assert.strictEqual(cleanedUnion.properties.payload.properties.text.type, 'STRING');
console.log('  PASSED');

// Test 5: Deeply nested user case matching Claude Code v2.1.302 function declarations
console.log('• Testing real-world nested function declaration schema from Claude Code...');
const claudeCodeToolSchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          config: {
            anyOf: [
              {
                oneOf: [
                  { const: 'exact_val_1', type: 'string' },
                  { const: 'exact_val_2', type: 'string' }
                ]
              }
            ]
          },
          minVal: {
            type: 'number',
            exclusiveMinimum: 5
          },
          multiTypeField: {
            type: ['string', 'null']
          }
        }
      }
    }
  }
};

const sanitizedClaudeTool = sanitizeGoogleSchema(claudeCodeToolSchema);
// Recursively check no const, exclusiveMinimum, uniqueItems or array types remain
function assertNoProhibitedKeys(obj: any, path = '') {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, idx) => assertNoProhibitedKeys(item, `${path}[${idx}]`));
    return;
  }
  assert.strictEqual(obj.const, undefined, `Found "const" at ${path}`);
  assert.strictEqual(obj.exclusiveMinimum, undefined, `Found "exclusiveMinimum" at ${path}`);
  assert.strictEqual(obj.exclusiveMaximum, undefined, `Found "exclusiveMaximum" at ${path}`);
  assert.strictEqual(obj.uniqueItems, undefined, `Found "uniqueItems" at ${path}`);
  assert.strictEqual(obj.anyOf, undefined, `Found "anyOf" at ${path}`);
  assert.strictEqual(obj.oneOf, undefined, `Found "oneOf" at ${path}`);
  assert.strictEqual(obj.allOf, undefined, `Found "allOf" at ${path}`);
  if (obj.type) {
    assert.strictEqual(typeof obj.type, 'string', `Type at ${path} is not string: ${JSON.stringify(obj.type)}`);
  }
  for (const [k, v] of Object.entries(obj)) {
    assertNoProhibitedKeys(v, `${path}.${k}`);
  }
}

assertNoProhibitedKeys(sanitizedClaudeTool);
console.log('  PASSED: All prohibited fields successfully eradicated and sanitized!');

// Test 6: Preservation of legitimate parameter names (pattern, title, format, default)
console.log('• Testing preservation of parameter names like "pattern", "title", "format"...');
const globSchema = {
  type: 'object',
  properties: {
    pattern: {
      type: 'string',
      description: 'The glob pattern'
    },
    path: {
      type: 'string'
    }
  },
  required: ['pattern']
};
const cleanedGlob = sanitizeGoogleSchema(globSchema);
assert.strictEqual(cleanedGlob.properties.pattern.type, 'STRING');
assert.strictEqual(cleanedGlob.properties.path.type, 'STRING');
assert.deepStrictEqual(cleanedGlob.required, ['pattern']);

const taskSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    format: { type: 'string' }
  },
  required: ['title']
};
const cleanedTask = sanitizeGoogleSchema(taskSchema);
assert.strictEqual(cleanedTask.properties.title.type, 'STRING');
assert.strictEqual(cleanedTask.properties.format.type, 'STRING');
assert.deepStrictEqual(cleanedTask.required, ['title']);
console.log('  PASSED: "pattern", "title", "format" properties cleanly preserved!');

// Test 7: Empty object schema adds synthetic placeholder for Google PA
console.log('• Testing empty object schema adds synthetic placeholder for Google PA...');
const emptySchema = {
  type: 'object',
  properties: {}
};
const cleanedEmpty = sanitizeGoogleSchema(emptySchema);
assert.strictEqual(cleanedEmpty.type, 'OBJECT');
assert.ok(cleanedEmpty.properties.reason);
assert.deepStrictEqual(cleanedEmpty.required, ['reason']);
console.log('  PASSED: Empty schema augmented with reason placeholder for PA');

console.log('='.repeat(70));
console.log('🎉 All Schema Sanitizer Pipeline Tests Passed Successfully!');
console.log('='.repeat(70));
