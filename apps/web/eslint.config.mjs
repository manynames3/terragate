import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  {
    ignores: [".next/**", "next-env.d.ts"],
    rules: {
      "react-hooks/set-state-in-effect": "off"
    }
  }
];

export default config;
