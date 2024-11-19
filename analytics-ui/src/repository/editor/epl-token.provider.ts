/*
 * $Copyright (c) 2024 Cumulocity GmbH, Duesseldorf, Germany , and/or its 
 * subsidiaries and/or its affiliates and/or their licensors.
 * Use, reproduction, transfer, publication or disclosure is prohibited except as specifically provided for in 
 * your License Agreement with Cumulocity GmbH
 */

export const eplTokenProvider = {
	keyword: [
		'new', 'return', 'import', 'package', 'as', 'all', 'returns', 'wait',
		'at', 'currentTime', 'unmatched', 'completed', 'select', 'join',
		'retain', 'within', 'partition', 'group', 'by', 'where', 'having', 'rstream',
		'every', 'with', 'unique', 'not', 'and', 'xor', 'or', 'equals',
		'event', 'monitor', 'action', 'wildcard', 'aggregate', 'bounded', 'unbounded',
		'constant', 'static', 'persistent'
	],
	constants: [
		'false', 'true'
	],
	types: [
		'string', 'integer', 'float', 'decimal', 'context', 'chunk', 'boolean', 'listener',
		'location', 'dictionary', 'sequence', 'stream', 'optional', 'any'
	],
	statements: [
		'if', 'then', 'while', 'else', 'for', 'on', 'from', 'route', 'emit',
		'enqueue', 'spawn', 'print', 'die', 'log', 'using', 'break', 'continue', 'send', 'to',
		'ifpresent', 'switch', 'case', 'default', 'try', 'catch', 'throw', 'in'
	],
	operators: [
		'+', '-', '/', '*', '=', ':=', '<', '>', '%', '!', ':'
	],
	symbols: /[\+\-\/\*\=\:\=\<\>\%\!\:]+/,
	escapes: /\\(?:[abfnrtv\\"']|x[0-9A-Fa-f]{1,4}|u[0-9A-Fa-f]{4}|U[0-9A-Fa-f]{8})/,
	digits: /\d+(_+\d+)*/,
	octaldigits: /[0-7]+(_+[0-7]+)*/,
	binarydigits: /[0-1]+(_+[0-1]+)*/,
	hexdigits: /[[0-9a-fA-F]+(_+[0-9a-fA-F]+)*/,
	defaultToken: '',
	tokenPostfix: '.mon',
	tokenizer: {
		root: [
			// identifiers and keywords
			[/[a-zA-Z_$][\w$]*/, {
				cases: {
					'@keyword': { token: 'keyword.$0' },
					'@constants': { token: 'constant.$0' },
					'@types': { token: 'type.$0' },
					'@statements': { token: 'keyword.$0' },
					'@default': 'identifier'
				}
			}],

			// whitespace
			{ include: '@whitespace' },

			// delimiters and operators
			[/[{}()\[\]]/, '@brackets'],
			// @ annotations.
			[/@\s*[a-zA-Z_\$][\w\$]*/, 'annotation'],

			// numbers
			[/[\-+]?(@digits)[eE]([\-+]?(@digits))?[fFdD]?/, 'number.float'],
			[/[\-+]?(@digits)\.(@digits)([eE][\-+]?(@digits))?[fFdD]?/, 'number.float'],
			[/0[xX](@hexdigits)[Ll]?/, 'number.hex'],
			[/0(@octaldigits)[Ll]?/, 'number.octal'],
			[/0[bB](@binarydigits)[Ll]?/, 'number.binary'],
			[/[\-+]?(@digits)[fFdD]/, 'number.float'],
			[/[\-+]?(@digits)[lL]?/, 'number'],

			// ordering is important - allow numbers to be matched before symbols so that -ve nums colorize properly
			[/@symbols/, {
				cases: {
					'@operators': 'operator',
					'@default': ''
				}
			}],
			// delimiter: after number because of .\d floats
			[/[;,.]/, 'delimiter'],

			// strings
			[/"([^"\\]|\\.)*$/, 'string.invalid'],  // non-teminated string
			[/"/, 'string', '@string'],

			// characters
			[/'[^\\']'/, 'string'],
			[/(')(@escapes)(')/, ['string', 'string.escape', 'string']],
			[/'/, 'string.invalid']
		],

		whitespace: [
			[/[ \t\r\n]+/, ''],
			[/\/\*\*(?!\/)/, 'comment.doc', '@javadoc'],
			[/\/\*/, 'comment', '@comment'],
			[/\/\/.*$/, 'comment'],
		],

		comment: [
			[/[^\/*]+/, 'comment'],
			[/\*\//, 'comment', '@pop'],
			[/[\/*]/, 'comment']
		],
		javadoc: [
			[/[^\/*]+/, 'comment.doc'],
			// [/\/\*/, 'comment.doc', '@push' ],
			[/\/\*/, 'comment.doc.invalid'],
			[/\*\//, 'comment.doc', '@pop'],
			[/[\/*]/, 'comment.doc']
		],

		string: [
			[/[^\\"]+/, 'string'],
			[/@escapes/, 'string.escape'],
			[/\\./, 'string.escape.invalid'],
			[/"/, 'string', '@pop']
		],
	}
};

export default eplTokenProvider;