import tseslint from "@typescript-eslint/eslint-plugin";
import globals from "globals";
import { importX } from "eslint-plugin-import-x";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefreshModule from "eslint-plugin-react-refresh";
import unusedImports from "eslint-plugin-unused-imports";

const tsFiles = ["src/**/*.{ts,tsx}"];
const reactFiles = ["src/react/**/*.tsx"];
const reactRefresh = reactRefreshModule.default ?? reactRefreshModule;

// User-visible strings come from i18n/<language>.json: these attributes and calls must not
// take a literal text. Disable a line with `eslint-disable-next-line` when the text is not
// meant to be translated (a format name, a symbol...).
const TRANSLATED_ATTRIBUTES = "/^(title|aria-label|placeholder|alt|tip|label|okText|cancelText)$/";
const TEXT = "/[A-Za-z]{2}/";
const HARD_CODED_STRING = "Hard-coded UI string: add it to i18n/en.json and use $t() or t().";
const hardCodedStrings = [
	`JSXAttribute[name.name=${TRANSLATED_ATTRIBUTES}] > Literal[value=${TEXT}]`,
	`JSXAttribute[name.name=${TRANSLATED_ATTRIBUTES}] > JSXExpressionContainer Literal[value=${TEXT}]:not(CallExpression > Literal)`,
	`JSXAttribute[name.name=${TRANSLATED_ATTRIBUTES}] > JSXExpressionContainer TemplateLiteral > TemplateElement[value.raw=${TEXT}]`,
	// text shown between tags through an expression: {count > 0 ? `${count} slides` : 'Slides'};
	// comparisons, keys and call arguments are not shown
	`:matches(JSXElement, JSXFragment) > JSXExpressionContainer Literal[value=${TEXT}]:not(CallExpression > Literal, BinaryExpression > Literal, MemberExpression > Literal, Property > Literal, JSXOpeningElement Literal)`,
	`:matches(JSXElement, JSXFragment) > JSXExpressionContainer TemplateLiteral:not(CallExpression > TemplateLiteral, JSXOpeningElement TemplateLiteral) > TemplateElement[value.raw=${TEXT}]`,
	`CallExpression[callee.object.name="message"] > Literal[value=${TEXT}]`,
	`CallExpression[callee.object.name="message"] Property[key.name="content"] > Literal[value=${TEXT}]`,
	`CallExpression[callee.name="setError"] > Literal[value=${TEXT}]`,
	`CallExpression[callee.name="setError"] > ConditionalExpression > Literal[value=${TEXT}]`,
].map(selector => ({ selector, message: HARD_CODED_STRING }));

const scopeConfig = (config, files) => ({
	...config,
	files,
});

export default [
	{
		ignores: ["**/*.d.ts", "dist", "vditor"],
	},
	...tseslint.configs["flat/recommended"].map((config) => scopeConfig(config, tsFiles)),
	{
		files: tsFiles,
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		plugins: {
			"import-x": importX,
			"unused-imports": unusedImports,
		},
		settings: {
			...importX.flatConfigs.typescript.settings,
		},
		rules: {
			"unused-imports/no-unused-imports": "error",
			"@typescript-eslint/no-var-requires": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-empty-function": "off",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-empty-object-type": "off",
			"@typescript-eslint/no-this-alias": "off"
		},
	},
	scopeConfig(reactPlugin.configs.flat.recommended, reactFiles),
	scopeConfig(reactPlugin.configs.flat["jsx-runtime"], reactFiles),
	scopeConfig(reactHooks.configs.flat.recommended, reactFiles),
	scopeConfig(reactRefresh.configs.recommended, reactFiles),
	{
		files: reactFiles,
		settings: {
			react: {
				version: "19.2",
			},
		},
		rules: {
			"unused-imports/no-unused-imports": "error",
			"react/jsx-no-target-blank": "off",
			"react/jsx-no-literals": ["error", { allowedStrings: ["Aa", "·", "/", "%", "×", "…", "-", "|"] }],
			"no-restricted-syntax": ["error", ...hardCodedStrings],
			"react-refresh/only-export-components": [
				"warn",
				{ allowConstantExport: true },
			],
		},
	},
];
