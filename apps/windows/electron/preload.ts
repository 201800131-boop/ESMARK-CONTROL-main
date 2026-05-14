import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("esmarkUpdates", {
  sendUpdateAction: (action: "install" | "later") => {
    ipcRenderer.send("update-action", action);
  },
});
