import { ConfigurationOptions } from '@c8y/devkit';
import { author, description, version, license } from './package.json';

export default {
  runTime: {
    author,
    description,
    license,
    version,
    name: 'Analytics Builder Management', // key for repository connect
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
        name: 'Analytics Builder Management',
        module: 'AnalyticsExtensionModule',
        path: './src/analytics-extension.module',
        description: 'Manage blocks for the Analytics Builder',
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
        from: '../resources/images-optimized/extension-upload.png',
        to: 'resources/images/extension-upload.png',
      },
      {
        from: '../resources/images-optimized/block-list.png',
        to: 'resources/images/block-list.png',
      },
      {
        from: '../resources/images-optimized/extension-update-modal.png',
        to: 'resources/images/extension-update-modal.png',
      },
      {
        from: '../resources/images-optimized/extension-safe-mode-complete.png',
        to: 'resources/images/extension-safe-mode-complete.png',
      },
      {
        from: '../resources/images-optimized/repository-access-denied.png',
        to: 'resources/images/repository-access-denied.png',
      },
      {
        from: '../resources/images-optimized/repository-personal-access-token.png',
        to: 'resources/images/repository-personal-access-token.png',
      },
      {
        from: '../resources/images-optimized/block-use-in-model.png',
        to: 'resources/images/block-use-in-model.png',
      },
      {
        from: '../resources/images-optimized/extension-manage.png',
        to: 'resources/images/extension-manage.png',
      },
      {
        from: '../resources/images-optimized/repository-manage.png',
        to: 'resources/images/repository-manage.png',
      },
      {
        from: '../resources/images-optimized/repository-view-code-modal.png',
        to: 'resources/images/repository-view-code-modal.png',
      },
      {
        from: '../resources/images-optimized/extension-create-modal.png',
        to: 'resources/images/extension-create-modal.png',
      },
      {
        from: '../resources/images-optimized/plugin-installation.png',
        to: 'resources/images/plugin-installation.png',
      },
      {
        from: '../resources/images-optimized/block-example-detail.png',
        to: 'resources/images/block-example-detail.png',
      },
      {
        from: '../resources/images-optimized/extension-build-information.png',
        to: 'resources/images/extension-build-information.png',
      },
      {
        from: '../README.md',
        to: 'README.md',
      },
    ],
  },
} as const satisfies ConfigurationOptions;
