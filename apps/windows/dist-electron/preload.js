"use strict";const e=require("electron");e.contextBridge.exposeInMainWorld("esmarkUpdates",{sendUpdateAction:t=>{e.ipcRenderer.send("update-action",t)}});
