import eslint from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";

export default [
	{
		ignores: ["node_modules/", "main.js"],
	},
	eslint.configs.recommended,
	{
		files: ["*.mjs"],
		languageOptions: {
			sourceType: "module",
			globals: {
				process: "readonly",
				console: "readonly",
			},
		},
	},
	{
		files: ["**/*.ts"],
		languageOptions: {
			parser: tsParser,
			sourceType: "module",
		},
		plugins: {
			"@typescript-eslint": tsPlugin,
		},
		rules: {
			...tsPlugin.configs["eslint-recommended"].overrides[0].rules,
			...tsPlugin.configs.recommended.rules,
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["error", { "args": "none" }],
			"@typescript-eslint/ban-ts-comment": "off",
			"no-prototype-builtins": "off",
			"@typescript-eslint/no-empty-function": "off",
		},
	},
];
