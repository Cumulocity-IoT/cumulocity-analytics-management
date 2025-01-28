import { ConfigurationOptions } from '@c8y/devkit';
import { author, description, version, license } from './package.json';

export default {
  runTime: {
    author,
    description,
    license,
    version,
    name: 'Analytics Extension', // key for repository connect
    contextPath: 'sag-ps-pkg-analytics-extension', // key for repository connect
    key: 'sag-ps-pkg-analytics-extension-pluginn-key', // key for repository connect
    contentSecurityPolicy:
      "base-uri 'none'; default-src 'self' 'unsafe-inline' http: https: ws: wss:; connect-src 'self' http: https: ws: wss:;  script-src 'self' *.bugherd.com *.twitter.com *.twimg.com *.aptrinsic.com 'unsafe-inline' 'unsafe-eval' data:; style-src * 'unsafe-inline' blob:; img-src * data: blob:; font-src * data:; frame-src *; worker-src 'self' blob:;",
    dynamicOptionsUrl: '/apps/public/public-options/options.json',
    remotes: {
      'sag-ps-pkg-analytics-extension': ['AnalyticsExtensionModule'],
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
        from: '../resources/images',
        to: 'resources/images',
      },
      {
        from: '../README.md',
        to: 'README.md',
      },
    ],
  },
} as const satisfies ConfigurationOptions;
