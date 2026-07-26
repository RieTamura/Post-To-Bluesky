import eslint from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";

export default [
	{
		ignores: ["node_modules/", "main.js"],
	},
	eslint.configs.recommended,
	// Obsidian のコミュニティプラグイン審査で走るスキャンと同じルールセット。
	// push 前に手元で確認できるようにするために入れている
	...obsidianmd.configs.recommended,
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
			// obsidianmd の推奨セットには型情報を要するルールが含まれるため必須
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
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
