import js from '@eslint/js'
import globals from 'globals'
import tsEslint from 'typescript-eslint'
import pluginVue from 'eslint-plugin-vue'
import prettierConfig from 'eslint-config-prettier'

export default tsEslint.config(
  // 忽略规则
  {
    ignores: ['node_modules', 'dist', '*.local', '.vite', '.vscode', '.idea'],
  },

  // 基础 JS 规则
  js.configs.recommended,

  // TypeScript 规则
  ...tsEslint.configs.recommended,

  // Vue 规则
  ...pluginVue.configs['flat/recommended'],

  // 全局通用配置（语言选项与全局变量）
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },

  // Vue 文件专用配置
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tsEslint.parser,
      },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },

  /* ==========================================================================
   * 六边形架构依赖边界约束 (Hexagonal Architecture Boundary Rules)
   * ========================================================================== */

  // 1. Domain 层：纯业务核心
  // 规则：严禁依赖外层架构（application, ports, adapters, infrastructure, presentation, stores 等），
  //       严禁依赖 Vue / 网络 / 地图等外部技术库。
  {
    files: ['src/domain/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/application/**',
                '**/application/**',
                '@/ports/**',
                '**/ports/**',
                '@/adapters/**',
                '**/adapters/**',
                '@/infrastructure/**',
                '**/infrastructure/**',
                '@/presentation/**',
                '**/presentation/**',
                '@/stores/**',
                '**/stores/**',
                '@/router/**',
                '**/router/**',
                '@/components/**',
                '**/components/**',
                'vue',
                'vue-router',
                'pinia',
                'axios',
                'element-plus',
                'ol',
                'ol/**',
                'cesium',
                'cesium/**',
                'ol-cesium',
              ],
              message:
                '【架构违规】Domain 层是纯业务核心，严禁依赖外层架构（application, ports, adapters 等）及外部UI/网络/地图库！',
            },
          ],
        },
      ],
    },
  },

  // 2. Ports 层：端口契约定义
  // 规则：只能依赖 domain 实体/值对象，严禁依赖 adapters 具体实现、infrastructure、application 或 UI 表现层。
  {
    files: ['src/ports/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/application/**',
                '**/application/**',
                '@/adapters/**',
                '**/adapters/**',
                '@/infrastructure/**',
                '**/infrastructure/**',
                '@/presentation/**',
                '**/presentation/**',
                '@/stores/**',
                '**/stores/**',
                '@/router/**',
                '**/router/**',
                'vue',
                'vue-router',
                'pinia',
                'axios',
                'element-plus',
              ],
              message:
                '【架构违规】Ports 端口层仅用于定义契约抽象，只能依赖 domain，严禁依赖 adapters、infrastructure、application 或 UI 层！',
            },
          ],
        },
      ],
    },
  },

  // 3. Application 层：业务用例编排 (Use Cases)
  // 规则：只能依赖 domain 和 ports；严禁直接依赖具体 adapters、infrastructure（由 bootstrap 装配）、UI 表现层或 Vue 组件。
  {
    files: ['src/application/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/adapters/**',
                '**/adapters/**',
                '@/infrastructure/**',
                '**/infrastructure/**',
                '@/presentation/**',
                '**/presentation/**',
                '@/stores/**',
                '**/stores/**',
                '@/router/**',
                '**/router/**',
                '@/components/**',
                '**/components/**',
                'vue',
                'element-plus',
              ],
              message:
                '【架构违规】Application 用例层只能依赖 domain 和 ports，严禁直接依赖具体 adapters、infrastructure 或 UI 表现层！',
            },
          ],
        },
      ],
    },
  },

  // 4. Adapters 层：端口适配器具体实现
  // 规则：实现 ports 契约，可调用 infrastructure 与第三方驱动，但严禁反向依赖 application 用例、presentation 视图或 stores 状态。
  {
    files: ['src/adapters/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/application/**',
                '**/application/**',
                '@/presentation/**',
                '**/presentation/**',
                '@/stores/**',
                '**/stores/**',
                '@/router/**',
                '**/router/**',
                '@/components/**',
                '**/components/**',
              ],
              message:
                '【架构违规】Adapters 适配器层严禁依赖 application 用例、presentation 视图层或 UI 状态（stores）！',
            },
          ],
        },
      ],
    },
  },

  // 5. Infrastructure 层：基础设施与通用工具
  // 规则：严禁依赖 presentation 表现层或 stores。
  {
    files: ['src/infrastructure/**/*.{ts,js}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/presentation/**',
                '**/presentation/**',
                '@/stores/**',
                '**/stores/**',
                '@/router/**',
                '**/router/**',
                '@/components/**',
                '**/components/**',
              ],
              message:
                '【架构违规】Infrastructure 基础设施层严禁依赖 presentation 表现层或 stores 状态！',
            },
          ],
        },
      ],
    },
  },

  // 6. Presentation / Stores / Router / Components 表现层
  // 规则：严禁直接依赖 adapters 具体实现！必须通过 application 用例或 bootstrap 容器进行交互。
  {
    files: [
      'src/presentation/**/*.{ts,js,vue}',
      'src/components/**/*.{ts,js,vue}',
      'src/stores/**/*.{ts,js}',
      'src/router/**/*.{ts,js}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/adapters/**', '**/adapters/**'],
              message:
                '【架构违规】Presentation 表现层禁止直接依赖 adapters 具体适配器，请通过 application 用例或 bootstrap 容器进行调用！',
            },
          ],
        },
      ],
    },
  },

  // Prettier 冲突处理（置于最后）
  prettierConfig,
)
