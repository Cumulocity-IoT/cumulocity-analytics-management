# cumulocity-analytics-management

## Content
- [Overview](#overview)
- [Installation](#installation)
- [Content](#content)
- [Build Instructions](#build-instructions)
- [User Guide](#user-guide)
- [Analytics Builder Block SDK](#analytics-builder-block-sdk)

## Overview

Extends the standard Cumulocity web application with a plugin to manage and add Analytics Builder extensions. Currently the standard UI does not allow the upload of custom blocks via .zip files. This extension of the standard Streaming-Analytics UI adds an plugin to add and a list of all loaded custom blocks.

![Extension installation](resources/images/extension-installation.png)

In addition a table lists all installed blocks, with information if it is a custom block.

![Block list](resources/images/block-list.png)

## Installation

The plugin is available as a community plugin and can be installed from the Administratio -> Extensions UI:

![Plugin installation](resources/images/plugin-installation.png)

## Build Instructions

This guide will teach you how to add the modified administration application to your tenant.
To upload the latest application release into your tenant, just go to the [Releases](https://github.com/SoftwareAG/cumulocity-analytics-management/releases) and download the analytics-extension.zip package.

Afterwards, login to your Cumulocity IoT Tenant and go to Administration--Applications--Own applications. To add the modified administration webb application click on Add application. After that, select Upload web application and drop the pre-downloaded zip-folder into the field.

Finally, you should see the new application in your App-Switcher.

![Upload Analytics Extension](resources/images/animated-installation-plugin.gif)
<!-- <br/>
<p align="center" style="text-indent:70px;">
  <a>
    <img width="70%" src="http://g.recordit.co/F4P3AQmC11.gif">
  </a>
</p>
<br/> -->


**Prerequisites:**
  
* Git
  
* NodeJS (release builds are currently built with `v16.20.0`)
  
* NPM (Included with NodeJS)

**Instructions**

Make sure you set the environments url, username, password before starting.

1. Clone the repository:
```
git clone https://github.com/SoftwareAG/cumulocity-analytics-management.git
```
2. Change directory:

  ```cd cumulocity-analytics-management```

3. run npm i command to install all library files specified in source code

  ```npm i ``` 

4. (Optional) Local development server:
  
  ```npm start```

6. Build the app:

  ```npm run build```

7. Deploy the app:
  ```npm run deploy```
## User Guide

You can upload blocks that were generated via the [Apama Analytics Builder Block SDK](https://github.com/SoftwareAG/apama-analytics-builder-block-sdk) via the "Add extension" button. Drop the .zip file there and the extension will be loaded. In order to use them you have to restart the streaming analytics engine. Click on the "Restart Streaming Analytics" button and wait for the notification that the engine was restarted.

![Using Analytics Extension](resources/images/animated-using-plugin.gif)
<!-- <br/>
<p align="center" style="text-indent:70px;">
  <a>
    <img width="70%" src="http://g.recordit.co/rVfxvThOmc.gif">
  </a>
</p>
<br/> -->


After the restart the Block will be available within the Steaming Analytics Application. Deleting a block will remove the block again. Keep in mind that no checking of any usage of that particular custom block is done an thus straming flows might not work anymore.

![Use Extension](resources/images/analytics-builder.png)

<!-- <br/>
<p align="center" style="text-indent:70px;">
  <a>
    <img width="70%" src="resources/images/analytics-builder.png">
  </a>
</p>
<br/> -->

## Analytics Builder Block SDK

Custom blocks can be generated via the [Apama Analytics Builder block sdk](https://github.com/SoftwareAG/apama-analytics-builder-block-sdk). 
Find addtional information on how blocks can be developed. However in the release section is one example block included that can be used for test purposes.

The provided block is an example of the machine learning block that also allows ONNX models.

![Use Extension](resources/images/block-detail.png)
<!-- <br/>
<p align="center" style="text-indent:70px;">
  <a>
    <img width="70%" src="resources/images/block-detail.png">
  </a>
</p>
<br/> -->

------------------------------

These tools are provided as-is and without warranty or support. They do not constitute part of the Software AG product suite. Users are free to use, fork and modify them, subject to the license agreement. While Software AG welcomes contributions, we cannot guarantee to include every contribution in the master project.
_____________________
For more information you can Ask a Question in the [TECHcommunity Forums](https://tech.forums.softwareag.com/tags/c/forum/1/cumulocity-iot).

You can find additional information in the [Software AG TECHcommunity](https://tech.forums.softwareag.com/tag/cumulocity-iot).
