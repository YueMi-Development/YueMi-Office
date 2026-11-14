import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * The lint rules for the TypeScript side of the repository.
 *
 * ESLint is used rather than a single bundled tool because the tree already
 * carries `eslint-disable-next-line react-hooks/exhaustive-deps` comments,
 * and a linter that does not know that rule name would leave dead
 * directives behind. The React rules below also catch defects that the
 * type checker cannot: a ref that is read while the component renders, a
 * state that is set from an effect, and a value that is mutated after a
 * memo was made.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/target/**',
      '**/.venv/**',
      // The agent skills carry their own scripts and examples. They are
      // read by an agent rather than built by this repository, so they are
      // outside the TypeScript build.
      '.agents/**',
      'bun.lock',
      'apps/desktop/src-tauri',
      // The icons are generated from one picture, and the Rust tool that
      // writes them is not part of the TypeScript build.
      'apps/desktop/src-tauri/icons',
    ],
  },

  js.configs.recommended,
  tseslint.configs.recommendedTypeChecked,
  reactHooks.configs.flat['recommended-latest'],
  jsxA11y.flatConfigs.recommended,

  {
    languageOptions: {
      parserOptions: {
        // The project service reads the tsconfig of each file, so the
        // scripts at the root and the two packages are all covered by one
        // configuration.
        projectService: {
          // The configuration files and the bundler's own configuration sit
          // outside every TypeScript project, and they still have to be
          // parsed rather than skipped.
          allowDefaultProject: ['eslint.config.mjs', 'apps/desktop/vite.config.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The data that comes back from the model API and from the render
      // service is JSON that no type describes. The code narrows it by
      // hand, and these rules would ask for the narrowing to be repeated
      // on every use of an already narrowed value.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      // An assertion that states the type the author already checked is
      // the clearest way to write that check, and the rule asks for a
      // second, different way to say the same thing.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // A function that awaits nothing is not wrong; it is a function that
      // will await something later, and the rule would have it say so.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          // A value that is taken apart with a rest element is dropped on
          // purpose. The config carries `hasKey`, which says whether a key
          // is stored, and the config that is written back must not carry
          // it, so the field is removed by naming it and not using it.
          ignoreRestSiblings: true,
          // A name that starts with an underscore is a name that is kept
          // for the reader rather than for the program.
          argsIgnorePattern: '^_',
        },
      ],
    },
  },
);
