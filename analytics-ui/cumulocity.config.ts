import { ConfigurationOptions } from '@c8y/devkit';
import { author, description, version, license } from './package.json';

export default {
  runTime: {
    author,
    description,
    license,
    version,
    name: 'Analytics Extension', // key for repository connect
    contextPath: 'c8y-pkg-analytics-extension', // key for repository connect
    key: 'c8y-pkg-analytics-extension-key', // key for repository connect
    contentSecurityPolicy:
      "base-uri 'none'; default-src 'self' 'unsafe-inline' http: https: ws: wss:; connect-src 'self' http: https: ws: wss:;  script-src 'self' *.bugherd.com *.twitter.com *.twimg.com *.aptrinsic.com 'unsafe-inline' 'unsafe-eval' data:; style-src * 'unsafe-inline' blob:; img-src * data: blob:; font-src * data:; frame-src *; worker-src 'self' blob:;",
    dynamicOptionsUrl: '/apps/public/public-options/options.json',
    remotes: {
      'c8y-pkg-analytics-extension': ['AnalyticsExtensionModule'],
    },
    package: 'plugin',
    isPackage: true,
    noAppSwitcher: true,
    exports: [
      {
        name: 'Analytics Builder Extension',
        module: 'AnalyticsExtensionModule',
        path: './src/analytics-extension.module',
        description: 'Adds Extensions for the Analytics Builder',
      },
    ],
  },
  buildTime: {
    federation: [
      '@angular/animations',
      '@angular/cdk',
      '@angular/common',
      '@angular/compiler',
      '@angular/core',
      '@angular/forms',
      '@angular/platform-browser',
      '@angular/platform-browser-dynamic',
      '@angular/router',
      '@angular/upgrade',
      '@c8y/client',
      '@c8y/ngx-components',
      'ngx-bootstrap',
      '@ngx-translate/core',
    ],
    copy: [
      {
        from: '../resources/images/extension-add-extension.png',
        to: 'resources/images/extension-add-extension.png',
      },
      {
        from: '../resources/images/block-block-list.png',
        to: 'resources/images/block-block-list.png',
      },
      {
        from: '../resources/images/extension-create-extension-animated.gif',
        to: 'resources/images/extension-create-extension-animated.gif',
      },
      {
        from: '../resources/images/extension-update-extension-modal.png',
        to: 'resources/images/extension-update-extension-modal.png',
      },
      {
        from: '../resources/images/extension-safe-mode.png',
        to: 'resources/images/extension-safe-mode.png',
      },

      {
        from: '../resources/images/use-analytics-builder-block.png',
        to: 'resources/images/use-analytics-builder-block.png',
      },
      {
        from: '../resources/images/extension-manage-extension.png',
        to: 'resources/images/extension-manage-extension.png',
      },
      {
        from: '../resources/images/repository-samples-manage-repository.png',
        to: 'resources/images/repository-samples-manage-repository.pn',
      },
      {
        from: '../resources/images/repository-samples-view-code-modal.png',
        to: 'resources/images/repository-samples-view-code-modal.png',
      },
      {
        from: '../resources/images/extension-create-extension-modal.png',
        to: 'resources/images/extension-create-extension-modal.png',
      },
      {
        from: '../resources/images/plugin-installation.png',
        to: 'resources/images/plugin-installation.png',
      },
      {
        from: '../resources/images/use-block-detail.png',
        to: 'resources/images/use-block-detail.png',
      },
      {
        from: '../README.md',
        to: 'README.md',
      },
    ],
  },
} as const satisfies ConfigurationOptions;
