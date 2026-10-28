import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
	...nextVitals,
	...nextTs,
	globalIgnores([".next/**", ".open-next/**", ".wrangler/**", "out/**", "build/**", "next-env.d.ts"]),
	{
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"react/no-unescaped-entities": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"react-hooks/set-state-in-effect": "off",
		},
	},
]);

export default eslintConfig;
