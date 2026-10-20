import { buildBlockMessagesEvt, buildBlockMetadataEvt, ParsedBlockMetadata, parseApamaBlockMetadata } from './apama-block-metadata';

const MON = `package com.acme.blocks;

using apama.analyticsbuilder.BlockBase;
using apama.analyticsbuilder.Activation;
using apama.analyticsbuilder.Value;

event ScaledSum_$Parameters {
	/** Scale factor.
	 *
	 * Multiplier applied to the sum.
	 *
	 * @$semanticType c8y_Measurement
	 */
	float factor;

	/** Label. */
	string label;
}

/** Scaled Sum.
 *
 * Adds two values and scales the result.
 *
 * Extended explanation.
 *
 * @$blockCategory Calculation
 * @$blockType transform
 * @$consumesInput
 * @$producesOutput
 */
event ScaledSum {
	BlockBase $base;
	ScaledSum_$Parameters $parameters;

	constant string $INPUT_TYPE_flag := "pulse";
	constant string $OUTPUT_TYPE_total := "float";

	action<Activation, float> $setOutput_total;
	action<Activation> $setOutput_done;

	/** Helper (must not be treated as a field). */
	action helper() {
		float ignored;
	}

	/**
	 * @$inputName a First value
	 * @$inputName b Second value.
	 * @param $input_a The first operand.
	 * @param $input_b The second operand.
	 */
	action $process(Activation $activation, float $input_a, optional<Value> $input_b, boolean $input_flag, dictionary<string,any> $input_extra) {
	}
}
`;

describe('apama-block-metadata', () => {
  describe('parseApamaBlockMetadata', () => {
    let block: ParsedBlockMetadata;
    beforeEach(() => {
      block = parseApamaBlockMetadata(MON, 'com.acme.blocks')[0];
    });

    it('reads id, title, description and tags from the block doc comment', () => {
      expect(block.id).toBe('com.acme.blocks.ScaledSum');
      expect(block.name).toBe('Scaled Sum');
      expect(block.description).toBe('Adds two values and scales the result.');
      expect(block.extendedDescription).toBe('Extended explanation.');
      expect(block.category).toBe('Calculation');
      expect(block.blockType).toBe('transform');
      expect(block.consumesInput).toBeTrue();
      expect(block.producesOutput).toBeTrue();
    });

    it('reads parameters with their doc, type and semantic type', () => {
      expect(block.parameters).toEqual([
        { id: 'factor', name: 'Scale factor', description: 'Multiplier applied to the sum.', type: 'float', semanticType: 'c8y_Measurement' },
        { id: 'label', name: 'Label', description: '', type: 'string', semanticType: undefined }
      ]);
    });

    it('reads inputs from $process in declaration order, with names, descriptions and normalized types', () => {
      expect(block.inputs.map(i => i.id)).toEqual(['a', 'b', 'flag', 'extra']);
      expect(block.inputs[0]).toEqual({ id: 'a', name: 'First value', description: 'The first operand.', type: 'float' });
      expect(block.inputs[1].type).toBe('any'); // optional<Value> -> any
      expect(block.inputs[1].name).toBe('Second value');
      expect(block.inputs[2].type).toBe('pulse'); // explicit $INPUT_TYPE constant wins
      expect(block.inputs[3].type).toBe('dictionary<string,any>'); // top-level comma split respects generics
      expect(block.inputs[3].name).toBe('extra'); // falls back to the id
    });

    it('reads outputs, defaulting the type to pulse', () => {
      expect(block.outputs.map(o => [o.id, o.type])).toEqual([['total', 'float'], ['done', 'pulse']]);
    });

    it('falls back to a minimal entry for undocumented blocks', () => {
      const [plain] = parseApamaBlockMetadata('event Plain { BlockBase $base; }', 'a.b');
      expect(plain).toEqual({
        id: 'a.b.Plain', name: 'Plain', description: '', extendedDescription: undefined,
        category: 'Utilities', blockType: undefined, consumesInput: undefined, producesOutput: undefined,
        inputs: [], outputs: [], parameters: []
      });
    });

    it('does not leak inputs/outputs between several blocks in one file', () => {
      const content = `
event Send { BlockBase $base; action<Activation> $setOutput_sent; action $process(Activation $a, float $input_x) { } }
event Receive { BlockBase $base; action<Activation> $setOutput_received; action $process(Activation $a, float $input_y) { } }`;
      const [send, receive] = parseApamaBlockMetadata(content, 'p');
      expect(send.inputs.map(i => i.id)).toEqual(['x']);
      expect(send.outputs.map(o => o.id)).toEqual(['sent']);
      expect(receive.inputs.map(i => i.id)).toEqual(['y']);
      expect(receive.outputs.map(o => o.id)).toEqual(['received']);
    });

    it('returns nothing for files without blocks', () => {
      expect(parseApamaBlockMetadata('monitor M { }', 'p')).toEqual([]);
    });
  });

  describe('evt builders', () => {
    const blocks = parseApamaBlockMetadata(MON, 'com.acme.blocks');

    /** Extracts and unescapes the JSON string literal from an .evt line. */
    const payloadOf = (evt: string) => {
      const [, literal] = /"EN", "(.*)"\)\s*$/.exec(evt.trim())!;
      return JSON.parse(JSON.parse(`"${literal}"`));
    };

    it('builds a BlockMetadata event with all blocks and a round-trippable payload', () => {
      const evt = buildBlockMetadataEvt('MyExt', blocks);
      expect(evt).toContain('"analyticsbuilder.metadata.requests",apama.analyticsbuilder.BlockMetadata("MyExt", "EN", "');
      const payload = payloadOf(evt);
      expect(payload.analytics.length).toBe(1);
      expect(payload.analytics[0].id).toBe('com.acme.blocks.ScaledSum');
      expect(payload.version).toBe('1.x.y');
    });

    it('builds a BlockMessages event with keys for block, inputs, outputs and parameters', () => {
      const evt = buildBlockMessagesEvt('MyExt', blocks);
      expect(evt).toContain('apama.analyticsbuilder.BlockMessages("MyExt", "EN", "');
      const messages = payloadOf(evt);
      const id = 'com.acme.blocks.ScaledSum';
      expect(messages[`block_${id}_name`]).toBe('Scaled Sum');
      expect(messages[`block_${id}_extendedDescription`]).toBe('Extended explanation.');
      expect(messages[`block_${id}_inputs_a_name`]).toBe('First value');
      expect(messages[`block_${id}_inputs_a_description`]).toBe('The first operand.');
      expect(messages[`block_${id}_outputs_total_name`]).toBe('total');
      expect(messages[`block_${id}_parameters_factor_description`]).toBe('Multiplier applied to the sum.');
    });

    it('omits empty descriptions from the messages', () => {
      const [plain] = parseApamaBlockMetadata('event Plain { BlockBase $base; }', 'a');
      const messages = payloadOf(buildBlockMessagesEvt('X', [plain]));
      expect(messages['block_a.Plain_description']).toBeUndefined();
      expect(messages['block_a.Plain_name']).toBe('Plain');
    });

    it('escapes quotes and backslashes so the MonitorScript literal stays valid', () => {
      const tricky: ParsedBlockMetadata = { id: 'p.B', name: 'Say "hi" \\ there', description: '', category: 'C', inputs: [], outputs: [], parameters: [] };
      const evt = buildBlockMetadataEvt('X', [tricky]);
      expect(payloadOf(evt).analytics[0].name).toBe('Say "hi" \\ there');
    });
  });
});
