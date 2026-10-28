import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
	...tseslint.configs.recommended,
	reactHooks.configs.flat.recommended,
	globalIgnores(["dist/**", ".wrangler/**"]),
	{
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"react-hooks/set-state-in-effect": "off",
		},
	},
]);

export default eslintConfig;
