/*
 * $Copyright (c) 2024 Cumulocity GmbH, Duesseldorf, Germany , and/or its 
 * subsidiaries and/or its affiliates and/or their licensors.
 * Use, reproduction, transfer, publication or disclosure is prohibited except as specifically provided for in 
 * your License Agreement with Cumulocity GmbH
 */

import { Injectable } from '@angular/core';
import eplTokenProvider from './epl-token.provider';
import * as monaco from 'monaco-editor';
@Injectable()
export class EplConfigService {

	constructor() { }

	/**
	 * Get Language Name
	 */
	public getLanguageName(): string {
		return 'epl';
	}

	/**
	 * Get Monaco editor theme defined for epl language
	 */
	public getThemeName(): string {
		return 'eplTheme';
	}

	/**
	 * Default Editor configuration options
	 */
	public defaultEditorConfigs(): monaco.editor.IStandaloneEditorConstructionOptions {
		return {
			autoIndent: 'advanced',
			autoClosingBrackets: 'languageDefined',
			autoSurround: 'languageDefined',
			matchBrackets: 'always',
			tabCompletion: 'on',
			codeLens: false,
			automaticLayout: true,
			contextmenu: true,
			copyWithSyntaxHighlighting: true,
			formatOnPaste: true,
			formatOnType: true,
			scrollBeyondLastLine: false,
			hover:{
				above: false
			},
			minimap: {
				enabled: true, maxColumn: 160,
				renderCharacters: true, showSlider: 'mouseover', side: 'right'
			},	// configures the minimap which appears on right side of the editor
			readOnly: false,	// Makes editor read-only,
			showUnused: true,
			wordWrap: 'on',
			wrappingIndent: 'same',
			mouseWheelZoom: true,
			theme: this.getThemeName()
		};
	}

	/**
	 * Get editing configuration for EPL Language.
	 * 
	 * As per monaco documentation : 
	 * The language configuration interface defines the contract between extensions and various editor features, 
	 * like automatic bracket insertion, automatic indentation etc.
	 */
	public getEPLLanguageConfig(): monaco.languages.LanguageConfiguration {
		return {
			// the default separators except `@$`
			wordPattern: /(-?\d*\.\d\w*)|([^\`\~\!\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g,
			comments: {
				lineComment: '//',
				blockComment: ['/*', '*/'],
			},
			brackets: [
				['{', '}'],
				['[', ']'],
				['(', ')'],
			],
			autoClosingPairs: [
				{ open: '{', close: '}' },
				{ open: '[', close: ']' },
				{ open: '(', close: ')' },
				{ open: '"', close: '"' },
				{ open: '\'', close: '\'' },
			],
			surroundingPairs: [
				{ open: '{', close: '}' },
				{ open: '[', close: ']' },
				{ open: '(', close: ')' },
				{ open: '"', close: '"' },
				{ open: '\'', close: '\'' },
				{ open: '<', close: '>' },
			],
			folding: {
				markers: {
					start: new RegExp('^\\s*//\\s*(?:(?:#?region\\b)|(?:<editor-fold\\b))'),
					end: new RegExp('^\\s*//\\s*(?:(?:#?endregion\\b)|(?:</editor-fold>))')
				}
			}
		};
	}

	/**
	 * Get monaco.languages.ILanguageExtensionPoint object for 'epl' Lanaguage
	 */
	public getCustomLangExtensionPoint(): monaco.languages.ILanguageExtensionPoint {
		const newLanguage: monaco.languages.ILanguageExtensionPoint = {
			id: 'epl',
			aliases: ['EPL', 'epl', 'Epl'],
			extensions: ['.mon', '.MON']
		};
		return newLanguage;
	}

	/**
	 * Get IMonarchTokenProvider object for 'epl' Language
	 * This object defines the rules for syntax highlighting.
	 */

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	public getCustomLangTokenProviders(): any {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		return <any>eplTokenProvider;
	}

	/**
	 * Creates and return custom Editor theme for EPL Language
	 */
	public getCustomLangTheme(): monaco.editor.IStandaloneThemeData {
		return {
			base: 'vs',
			inherit: false,
			rules: [
				{ token: 'keyword', foreground: '7F0055' },
				{ token: 'constant', foreground: '7F0055' },
				{ token: 'type', foreground: 'cd3a3a' },
				{ token: 'operator', foreground: '000000' },
				{ token: '@brackets', foreground: '000000' },
				{ token: 'comment', foreground: '3F7F5F' },
				{ token: 'comment.doc', foreground: '2A00FF' },
				{ token: 'string', foreground: '2A00FF' },
				{ token: 'number', foreground: '2A00FF' },
				{ token: 'number.hex', foreground: '2A00FF' },
				{ token: 'annotation', foreground: '7F7F7F' },
			],
			colors: {}
		};
	}
}