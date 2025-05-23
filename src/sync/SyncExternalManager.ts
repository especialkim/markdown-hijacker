import MarkdownHijacker from "main";
import { App } from "obsidian";
import { FolderConnectionSettings } from "src/settings/types";
import * as fs from 'fs';
import { SyncExternalManagerState, AddFileType, ChangeFileType, DeleteFileType, DeleteFolderType } from "./types";
import { SyncExternalDeleteEvent } from "./SyncExternalDeleteEvent";
import { SyncExternalAddEvent } from "./SyncExternalAddEvent";
import { SyncExternalChangeEvent } from "./SyncExternalChangeEvent";
import { SyncService } from "./SyncService";

export class SyncExternalManager {

    private app: App;
    private plugin: MarkdownHijacker;
    private connection: FolderConnectionSettings;
    private state: SyncExternalManagerState = {};
    private syncExternalAddEvent: SyncExternalAddEvent;
    private syncExternalDeleteEvent: SyncExternalDeleteEvent;
    private syncExternalChangeEvent: SyncExternalChangeEvent;

    constructor(app: App, plugin: MarkdownHijacker, connection: FolderConnectionSettings){
        this.app = app;
        this.plugin = plugin;
        this.connection = connection;
        this.state = {};
        this.syncExternalAddEvent = new SyncExternalAddEvent(app, plugin, connection);
        this.syncExternalDeleteEvent = new SyncExternalDeleteEvent(app, plugin, connection);
        this.syncExternalChangeEvent = new SyncExternalChangeEvent(app, plugin, connection);
    }
    
    /* Add File */
    public async handleAddFiles(paths: string[]){
        for(const path of paths){
            await this.handleAddFile(path);
        }
    }

    public async handleAddFile(path: string){

        /* State 초기화 */
        const createdAt = Date.now();

        if(this.state[path]) return;

        this.state[path] = {
            createdAt: createdAt,
            modifiedAt: 0,
            renamedAt: 0,
            deletedAt: 0,
        }
        const getState = () => this.state[path];

        /* Event 처리 대기 */
        await sleep(100);
        if(getState().modifiedAt !== 0 && getState().renamedAt !== 0 && getState().deletedAt !== 0) return;

        /* Check Add Type */
        const addFileType = this.checkAddFileType(path);
        /* Handle by AddFileType : System Event 처리 불필요함 */
        switch(addFileType){
            case AddFileType.USER_ADD_FILE:
                await this.syncExternalAddEvent.handleUserAddFile(path);
                break;
            case AddFileType.USER_ADD_MD_BLANK:
                await this.syncExternalAddEvent.handleUserAddMdBlank(path);
                break;
            case AddFileType.USER_ADD_MD_CONTENT:
                await this.syncExternalAddEvent.handleUserAddMdContent(path);
                break;
            case AddFileType.SYSTEM_ADD_FILE:
                await this.syncExternalAddEvent.handleSystemAddFile(path);
                break;
            case AddFileType.SYSTEM_ADD_MD_BLANK:
                await this.syncExternalAddEvent.handleSystemAddMdBlank(path);
                break;
            case AddFileType.SYSTEM_ADD_MD_CONTENT:
                await this.syncExternalAddEvent.handleSystemAddMdContent(path);
                break;
        }
        return;
    }

    /* Change File */
    private async checkChangeFileType(path: string){
        const relativePath = this.plugin.syncService.getRelativePath(path, this.connection);
        const internalAbsolutePath = this.plugin.syncService.getInternalAbsolutePath(relativePath, this.connection);
        const didChangeUser = !(await this.plugin.syncService.isSameFile(internalAbsolutePath, path));
        const isMarkdown = path.endsWith('.md');

        if(isMarkdown && didChangeUser) return ChangeFileType.USER_CHANGE_MD;
        if(isMarkdown && !didChangeUser) return ChangeFileType.SYSTEM_CHANGE_MD;
        if(!isMarkdown && didChangeUser) return ChangeFileType.USER_CHANGE_NOT_MD;
        if(!isMarkdown && !didChangeUser) return ChangeFileType.SYSTEM_CHANGE_NOT_MD;
    }

    public async handleChangeFiles(paths: string[]){
        for(const path of paths){
            await this.handleChangeFile(path);
        }
    }

    public async handleChangeFile(path: string){
        
        const changeFileType = await this.checkChangeFileType(path);

        switch(changeFileType){
            case ChangeFileType.USER_CHANGE_MD:
                await this.syncExternalChangeEvent.handleUserChangeMd(path);
                break;
            case ChangeFileType.USER_CHANGE_NOT_MD:
                await this.syncExternalChangeEvent.handleUserChangeNotMd(path);
                break;
            case ChangeFileType.SYSTEM_CHANGE_MD:
                await this.syncExternalChangeEvent.handleSystemChangeMd(path);
                break;
            case ChangeFileType.SYSTEM_CHANGE_NOT_MD:
                await this.syncExternalChangeEvent.handleSystemChangeNotMd(path);
                break;
        }
        return;
    }

    /* Delete File */
    private checkDeleteFileType(path: string){

        if(this.state[path]) delete this.state[path];

        let didUserDelete = true;
        const isMarkdown = path.endsWith('.md');

        const relativePath = this.plugin.syncService.getRelativePath(path, this.connection);
        const internalPath = this.plugin.syncService.getInternalPath(relativePath, this.connection);

        const internalFile = this.app.vault.getFileByPath(internalPath);
        if(!internalFile) didUserDelete = false;

        if(isMarkdown && didUserDelete) return DeleteFileType.USER_DELETE_MD;
        if(isMarkdown && !didUserDelete) return DeleteFileType.SYSTEM_DELETE_MD;
        if(!isMarkdown && didUserDelete) return DeleteFileType.USER_DELETE_NOT_MD;
        if(!isMarkdown && !didUserDelete) return DeleteFileType.SYSTEM_DELETE_NOT_MD;
    }
    
    public async handleDeleteFiles(paths: string[]){
        for(const path of paths){
            await this.handleDeleteFile(path);
        }
    }

    public async handleDeleteFile(path: string){

        const deleteFileType = this.checkDeleteFileType(path);

        /* 
            ※ SYSTEM_DELETE는 처리할 필요 없음        
        */
        switch(deleteFileType){
            case DeleteFileType.USER_DELETE_MD:
                this.syncExternalDeleteEvent.handleUserDeleteMd(path);
                break;
            case DeleteFileType.USER_DELETE_NOT_MD:
                this.syncExternalDeleteEvent.handleUserDeleteNotMd(path);
                break;
        }

        return;
    }

    /* Add Folder */
    public async handleAddFolder(path: string){
        this.syncExternalAddEvent.handleAddFolder(path);
        return;
    }

    /* Delete Folder */
    private checkDeleteFolderType(path: string){
        const relativePath = this.plugin.syncService.getRelativePath(path, this.connection);
        const internalPath = this.plugin.syncService.getInternalPath(relativePath, this.connection);

        const internalFolder = this.app.vault.getFolderByPath(internalPath);
        if(!internalFolder) return DeleteFolderType.SYSTEM_DELETE_FOLDER;
        return DeleteFolderType.USER_DELETE_FOLDER;
    }

    public async handleDeleteFolder(path: string){
        
        const deleteFolderType = this.checkDeleteFolderType(path);

        /* System Delete 처리 필요 없음 */
        switch(deleteFolderType){
            case DeleteFolderType.USER_DELETE_FOLDER:
                this.syncExternalDeleteEvent.handleUserDeleteFolder(path);
                break;
            case DeleteFolderType.SYSTEM_DELETE_FOLDER:
                this.syncExternalDeleteEvent.handleSystemDeleteFolder(path);
                break;
        }
    }

    /* ========================== Private Method ========================== */

    /* Generate Frontmatter */
    private isBlankFile(path: string): boolean {
        const content = fs.readFileSync(path, 'utf8');
        return content.trim() === '';
    }

    private checkAddFileType(path: string){
        const externalPath = path;
        const relativePath = this.plugin.syncService.getRelativePath(externalPath, this.connection);
        const internalPath = this.connection.internalPath + relativePath;
        
        let didUserAdd = true;
        const internalFile = this.app.vault.getFileByPath(internalPath);
        if(internalFile) didUserAdd = false;

        if (!relativePath.endsWith('.md')) {
            if(didUserAdd) return AddFileType.USER_ADD_FILE;
            return AddFileType.SYSTEM_ADD_FILE;
        }

        if (this.isBlankFile(externalPath)) {
            if(didUserAdd) return AddFileType.USER_ADD_MD_BLANK;
            return AddFileType.SYSTEM_ADD_MD_BLANK;
        } else {
            if(didUserAdd) return AddFileType.USER_ADD_MD_CONTENT;
            return AddFileType.SYSTEM_ADD_MD_CONTENT;
        }
    }
}