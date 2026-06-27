import { Injectable } from '@angular/core'
import { AppService, BaseTabComponent, ProfilesService, QuickConnectProfileProvider, SplitTabComponent } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { AITerminalMonitorService } from './aiTerminalMonitor.service'
import { tailText } from './text'

export type AITabbyActionName =
    'listSessions' |
    'getTerminalBuffer' |
    'sendInput' |
    'listTabs' |
    'selectTab' |
    'closeTab' |
    'listProfiles' |
    'openProfile' |
    'quickConnect' |
    'openSSH' |
    'sftpList' |
    'sftpRead' |
    'sftpWrite' |
    'sftpMkdir' |
    'sftpDelete' |
    'sftpRename' |
    'sftpStat'

export interface AITabbyToolAction {
    action?: AITabbyActionName|'terminalCommand'
    reason?: string
    sessionId?: string
    tabIndex?: number
    title?: string
    profileId?: string
    profileName?: string
    query?: string
    protocol?: 'auto'|'ssh'|'telnet'|'socket'|'serial'
    input?: string
    enter?: boolean
    maxChars?: number
    force?: boolean
    path?: string
    content?: string
    sourcePath?: string
    destPath?: string
    ssh?: {
        query?: string
        host?: string
        user?: string
        port?: number
        name?: string
    }
}

export interface AITabbyToolResult {
    message: string
    terminal?: BaseTerminalTabComponent<any>
    mutates: boolean
}

interface TerminalSession {
    sessionId: string
    tabIndex: number
    paneIndex?: number
    title: string
    tab: BaseTerminalTabComponent<any>
    parent: BaseTabComponent
    active: boolean
}

/** @hidden */
@Injectable({ providedIn: 'root' })
export class AITabbyToolsService {
    private terminalIds = new WeakMap<BaseTerminalTabComponent<any>, string>()

    constructor (
        private app: AppService,
        private profiles: ProfilesService,
        private monitor: AITerminalMonitorService,
    ) { }

    isToolAction (action: AITabbyToolAction): boolean {
        return !!action.action && action.action !== 'terminalCommand'
    }

    isMutatingAction (action: AITabbyToolAction): boolean {
        return ![
            'listSessions',
            'getTerminalBuffer',
            'listTabs',
            'listProfiles',
            'sftpList',
            'sftpRead',
            'sftpStat',
        ].includes(action.action ?? '')
    }

    describeAction (action: AITabbyToolAction): string {
        switch (action.action) {
            case 'quickConnect':
                return `quickConnect ${this.normalizeTarget(action.query ?? '')}`
            case 'openSSH':
                return `openSSH ${this.getSSHQuery(action)}`
            case 'sftpList':
            case 'sftpRead':
            case 'sftpWrite':
            case 'sftpMkdir':
            case 'sftpDelete':
            case 'sftpStat':
                return `${action.action} ${action.path ?? ''}`.trim()
            case 'sftpRename':
                return `sftpRename ${action.sourcePath ?? ''} -> ${action.destPath ?? ''}`
            case 'openProfile':
                return `openProfile ${action.profileId || action.profileName || ''}`.trim()
            case 'sendInput':
                return `sendInput ${JSON.stringify(action.input ?? '')}`
            case 'selectTab':
            case 'closeTab':
            case 'getTerminalBuffer':
                return `${action.action} ${this.describeLocator(action)}`.trim()
            default:
                return action.action ?? 'unknown'
        }
    }

    async execute (
        action: AITabbyToolAction,
        activeTerminal: BaseTerminalTabComponent<any>,
    ): Promise<AITabbyToolResult> {
        switch (action.action) {
            case 'listSessions':
                return { mutates: false, message: this.listSessions() }
            case 'getTerminalBuffer':
                return { mutates: false, message: this.getTerminalBuffer(action, activeTerminal) }
            case 'sendInput':
                return this.sendInput(action, activeTerminal)
            case 'listTabs':
                return { mutates: false, message: this.listTabs() }
            case 'selectTab':
                return this.selectTab(action)
            case 'closeTab':
                return await this.closeTab(action)
            case 'listProfiles':
                return await this.listProfiles()
            case 'openProfile':
                return await this.openProfile(action)
            case 'quickConnect':
                return await this.quickConnect(action)
            case 'openSSH':
                return await this.openSSH(action)
            case 'sftpList':
                return await this.sftpList(action, activeTerminal)
            case 'sftpRead':
                return await this.sftpRead(action, activeTerminal)
            case 'sftpWrite':
                return await this.sftpWrite(action, activeTerminal)
            case 'sftpMkdir':
                return await this.sftpMkdir(action, activeTerminal)
            case 'sftpDelete':
                return await this.sftpDelete(action, activeTerminal)
            case 'sftpRename':
                return await this.sftpRename(action, activeTerminal)
            case 'sftpStat':
                return await this.sftpStat(action, activeTerminal)
            default:
                throw new Error(`Unsupported AI Tabby action: ${action.action}`)
        }
    }

    getSSHQuery (action: AITabbyToolAction): string {
        const ssh = action.ssh
        if (!ssh) {
            throw new Error('AI did not provide SSH connection details')
        }
        const query = (ssh.query ?? '').trim()
        if (query) {
            return this.normalizeTarget(query)
        }
        const host = (ssh.host ?? '').trim()
        if (!host) {
            throw new Error('AI did not provide an SSH host')
        }
        const user = (ssh.user ?? '').trim()
        const port = ssh.port && ssh.port !== 22 ? `:${ssh.port}` : ''
        return this.normalizeTarget(`${user ? `${user}@` : ''}${host}${port}`)
    }

    private listSessions (): string {
        const sessions = this.getTerminalSessions().map(session => ({
            sessionId: session.sessionId,
            tabIndex: session.tabIndex,
            paneIndex: session.paneIndex,
            title: session.title,
            active: session.active,
            open: session.tab.session?.open ?? false,
        }))
        return JSON.stringify({ success: true, sessions, count: sessions.length }, null, 2)
    }

    private getTerminalBuffer (action: AITabbyToolAction, activeTerminal: BaseTerminalTabComponent<any>): string {
        const terminal = this.findTerminal(action) ?? activeTerminal
        const maxChars = Math.max(1000, action.maxChars ?? 16000)
        return JSON.stringify({
            success: true,
            sessionId: this.getSessionId(terminal),
            title: terminal.title,
            buffer: this.monitor.getText(terminal, maxChars),
        })
    }

    private sendInput (
        action: AITabbyToolAction,
        activeTerminal: BaseTerminalTabComponent<any>,
    ): AITabbyToolResult {
        const terminal = this.findTerminal(action) ?? activeTerminal
        const input = this.normalizeInput(action.input ?? '')
        terminal.sendInput(action.enter === false ? input : `${input}\r`)
        return {
            mutates: true,
            terminal,
            message: JSON.stringify({ success: true, sessionId: this.getSessionId(terminal), sent: input }),
        }
    }

    private listTabs (): string {
        const tabs = this.app.tabs.map((tab, index) => ({
            tabIndex: index,
            title: tab.title,
            active: tab === this.app.activeTab,
            type: tab.constructor?.name,
            panes: tab instanceof SplitTabComponent ? tab.getAllTabs().map(pane => ({
                title: pane.title,
                type: pane.constructor?.name,
            })) : undefined,
        }))
        return JSON.stringify({ success: true, tabs, count: tabs.length }, null, 2)
    }

    private selectTab (action: AITabbyToolAction): AITabbyToolResult {
        const tab = this.findTopLevelTab(action)
        if (!tab) {
            throw new Error('No matching tab found')
        }
        this.app.selectTab(tab)
        const terminal = this.firstTerminal(tab)
        return {
            mutates: true,
            terminal,
            message: JSON.stringify({ success: true, tabIndex: this.app.tabs.indexOf(tab), title: tab.title }),
        }
    }

    private async closeTab (action: AITabbyToolAction): Promise<AITabbyToolResult> {
        const tab = this.findTopLevelTab(action)
        if (!tab) {
            throw new Error('No matching tab found')
        }
        const title = tab.title
        const tabIndex = this.app.tabs.indexOf(tab)
        await this.app.closeTab(tab, !action.force)
        return {
            mutates: true,
            message: JSON.stringify({ success: true, tabIndex, title }),
        }
    }

    private async listProfiles (): Promise<AITabbyToolResult> {
        const profiles = await this.profiles.getProfiles()
        return {
            mutates: false,
            message: JSON.stringify({
                success: true,
                profiles: profiles.map(profile => ({
                    profileId: profile.id,
                    name: profile.name,
                    type: profile.type,
                    group: profile.group,
                })),
                count: profiles.length,
            }, null, 2),
        }
    }

    private async openProfile (action: AITabbyToolAction): Promise<AITabbyToolResult> {
        const allProfiles = await this.profiles.getProfiles()
        const profile = allProfiles.find(p =>
            (action.profileId && p.id === action.profileId) ||
            (action.profileName && p.name.toLowerCase().includes(action.profileName.toLowerCase()))
        )
        if (!profile) {
            throw new Error(`Profile not found: ${action.profileId || action.profileName || ''}`)
        }
        const tab = await this.profiles.openNewTabForProfile(profile)
        const terminal = tab ? this.firstTerminal(tab) : undefined
        return {
            mutates: true,
            terminal,
            message: JSON.stringify({ success: true, profileId: profile.id, name: profile.name, tabTitle: tab?.title }),
        }
    }

    private async quickConnect (action: AITabbyToolAction): Promise<AITabbyToolResult> {
        const query = this.normalizeTarget(action.query ?? '')
        if (!query) {
            throw new Error('Connection query is required')
        }

        const providers = this.profiles.getProviders()
            .filter((provider): provider is QuickConnectProfileProvider<any> => provider instanceof QuickConnectProfileProvider)
        const protocol = action.protocol ?? this.inferProtocol(query)
        const provider = protocol === 'auto'
            ? this.findAutoProvider(providers, query)
            : providers.find(x => x.id === protocol)
        if (!provider) {
            throw new Error(`Quick connect provider is not available: ${protocol}`)
        }

        const normalizedQuery = query.replace(/^(ssh|telnet|socket|serial):\/\//i, '')
        const profile = provider.quickConnect(normalizedQuery)
        if (!profile) {
            throw new Error(`Could not parse quick connect target: ${query}`)
        }
        const tab = await this.profiles.openNewTabForProfile(profile)
        const terminal = tab ? this.firstTerminal(tab) : undefined
        return {
            mutates: true,
            terminal,
            message: JSON.stringify({ success: true, protocol: provider.id, query, tabTitle: tab?.title }),
        }
    }

    private async openSSH (action: AITabbyToolAction): Promise<AITabbyToolResult> {
        return await this.quickConnect({
            ...action,
            action: 'quickConnect',
            protocol: 'ssh',
            query: this.getSSHQuery(action),
        })
    }

    private async sftpList (
        action: AITabbyToolAction,
        activeTerminal: BaseTerminalTabComponent<any>,
    ): Promise<AITabbyToolResult> {
        const sftp = await this.getSFTP(action, activeTerminal)
        const remotePath = this.normalizeRemotePath(action.path || '.')
        const files = await sftp.readdir(remotePath)
        return {
            mutates: false,
            message: JSON.stringify({
                success: true,
                path: remotePath,
                files: files.map(file => this.formatSFTPFile(file)),
            }, null, 2),
        }
    }

    private async sftpRead (
        action: AITabbyToolAction,
        activeTerminal: BaseTerminalTabComponent<any>,
    ): Promise<AITabbyToolResult> {
        const sftp = await this.getSFTP(action, activeTerminal)
        const remotePath = this.normalizeRemotePath(action.path)
        const content = await this.readRemoteText(sftp, remotePath)
        return {
            mutates: false,
            message: JSON.stringify({
                success: true,
                path: remotePath,
                content: tailText(content, action.maxChars ?? 64000),
                truncated: content.length > (action.maxChars ?? 64000),
            }),
        }
    }

    private async sftpWrite (
        action: AITabbyToolAction,
        activeTerminal: BaseTerminalTabComponent<any>,
    ): Promise<AITabbyToolResult> {
        const sftp = await this.getSFTP(action, activeTerminal)
        const remotePath = this.normalizeRemotePath(action.path)
        await this.writeRemoteText(sftp, remotePath, action.content ?? '')
        return {
            mutates: true,
            message: JSON.stringify({ success: true, path: remotePath, bytes: new TextEncoder().encode(action.content ?? '').length }),
        }
    }

    private async sftpMkdir (
        action: AITabbyToolAction,
        activeTerminal: BaseTerminalTabComponent<any>,
    ): Promise<AITabbyToolResult> {
        const sftp = await this.getSFTP(action, activeTerminal)
        const remotePath = this.normalizeRemotePath(action.path)
        await sftp.mkdir(remotePath)
        return {
            mutates: true,
            message: JSON.stringify({ success: true, path: remotePath }),
        }
    }

    private async sftpDelete (
        action: AITabbyToolAction,
        activeTerminal: BaseTerminalTabComponent<any>,
    ): Promise<AITabbyToolResult> {
        const sftp = await this.getSFTP(action, activeTerminal)
        const remotePath = this.normalizeRemotePath(action.path)
        const stat = await sftp.stat(remotePath)
        if (stat.isDirectory) {
            await sftp.rmdir(remotePath)
        } else {
            await sftp.unlink(remotePath)
        }
        return {
            mutates: true,
            message: JSON.stringify({ success: true, path: remotePath, directory: stat.isDirectory }),
        }
    }

    private async sftpRename (
        action: AITabbyToolAction,
        activeTerminal: BaseTerminalTabComponent<any>,
    ): Promise<AITabbyToolResult> {
        const sftp = await this.getSFTP(action, activeTerminal)
        const sourcePath = this.normalizeRemotePath(action.sourcePath)
        const destPath = this.normalizeRemotePath(action.destPath)
        await sftp.rename(sourcePath, destPath)
        return {
            mutates: true,
            message: JSON.stringify({ success: true, sourcePath, destPath }),
        }
    }

    private async sftpStat (
        action: AITabbyToolAction,
        activeTerminal: BaseTerminalTabComponent<any>,
    ): Promise<AITabbyToolResult> {
        const sftp = await this.getSFTP(action, activeTerminal)
        const remotePath = this.normalizeRemotePath(action.path)
        const stat = await sftp.stat(remotePath)
        return {
            mutates: false,
            message: JSON.stringify({ success: true, file: this.formatSFTPFile(stat) }, null, 2),
        }
    }

    private inferProtocol (query: string): 'auto'|'ssh'|'telnet'|'socket'|'serial' {
        const scheme = query.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase()
        if (scheme === 'ssh' || scheme === 'telnet' || scheme === 'socket' || scheme === 'serial') {
            return scheme
        }
        if (query.includes('@')) {
            return 'ssh'
        }
        return 'auto'
    }

    private findAutoProvider (
        providers: QuickConnectProfileProvider<any>[],
        query: string,
    ): QuickConnectProfileProvider<any>|undefined {
        const preferred = query.includes('@') ? 'ssh' : undefined
        if (preferred) {
            const provider = providers.find(x => x.id === preferred)
            if (provider) {
                return provider
            }
        }
        return providers.find(provider => !!provider.quickConnect(query))
    }

    private getTerminalSessions (): TerminalSession[] {
        const sessions: TerminalSession[] = []
        for (const [tabIndex, topLevelTab] of this.app.tabs.entries()) {
            const panes = topLevelTab instanceof SplitTabComponent ? topLevelTab.getAllTabs() : [topLevelTab]
            panes.forEach((pane, paneIndex) => {
                if (pane instanceof BaseTerminalTabComponent) {
                    sessions.push({
                        sessionId: this.getSessionId(pane),
                        tabIndex,
                        paneIndex: topLevelTab instanceof SplitTabComponent ? paneIndex : undefined,
                        title: pane.title,
                        tab: pane,
                        parent: topLevelTab,
                        active: pane.hasFocus || topLevelTab === this.app.activeTab,
                    })
                }
            })
        }
        return sessions
    }

    private async getSFTP (action: AITabbyToolAction, activeTerminal: BaseTerminalTabComponent<any>): Promise<any> {
        const terminal = this.findTerminal(action) ?? activeTerminal
        const sshSession = (terminal as any).sshSession
        if (!sshSession?.open) {
            throw new Error('SFTP requires an active SSH tab/session')
        }
        return await sshSession.openSFTP()
    }

    private async readRemoteText (sftp: any, remotePath: string): Promise<string> {
        const russh = require('russh')
        const handle = await sftp.open(remotePath, russh.OPEN_READ)
        const decoder = new TextDecoder()
        let content = ''
        try {
            while (true) {
                const chunk = await handle.read()
                if (!chunk.length) {
                    break
                }
                content += decoder.decode(chunk, { stream: true })
            }
            content += decoder.decode()
        } finally {
            await handle.close()
        }
        return content
    }

    private async writeRemoteText (sftp: any, remotePath: string, content: string): Promise<void> {
        const russh = require('russh')
        const tempPath = `${remotePath}.tabby-ai-upload`
        const handle = await sftp.open(tempPath, russh.OPEN_WRITE | russh.OPEN_CREATE)
        try {
            await handle.write(new TextEncoder().encode(content))
            await handle.close()
            await sftp.unlink(remotePath).catch(() => null)
            await sftp.rename(tempPath, remotePath)
        } catch (error) {
            await handle.close().catch(() => null)
            await sftp.unlink(tempPath).catch(() => null)
            throw error
        }
    }

    private formatSFTPFile (file: any): any {
        return {
            name: file.name,
            fullPath: file.fullPath,
            directory: file.isDirectory,
            symlink: file.isSymlink,
            mode: file.mode,
            size: file.size,
            modified: file.modified,
        }
    }

    private findTerminal (locator: AITabbyToolAction): BaseTerminalTabComponent<any>|null {
        const sessions = this.getTerminalSessions()
        if (locator.sessionId) {
            return sessions.find(x => x.sessionId === locator.sessionId)?.tab ?? null
        }
        if (locator.tabIndex !== undefined) {
            return sessions.find(x => x.tabIndex === locator.tabIndex)?.tab ?? null
        }
        if (locator.title) {
            const title = locator.title.toLowerCase()
            return sessions.find(x => x.title.toLowerCase().includes(title))?.tab ?? null
        }
        return null
    }

    private findTopLevelTab (locator: AITabbyToolAction): BaseTabComponent|null {
        if (locator.tabIndex !== undefined) {
            return this.app.tabs[locator.tabIndex] ?? null
        }
        if (locator.title) {
            const title = locator.title.toLowerCase()
            return this.app.tabs.find(tab => tab.title?.toLowerCase().includes(title)) ?? null
        }
        return this.app.activeTab
    }

    private firstTerminal (tab: BaseTabComponent): BaseTerminalTabComponent<any>|undefined {
        if (tab instanceof BaseTerminalTabComponent) {
            return tab
        }
        if (tab instanceof SplitTabComponent) {
            return tab.getAllTabs().find(pane => pane instanceof BaseTerminalTabComponent) as BaseTerminalTabComponent<any>|undefined
        }
        return undefined
    }

    private getSessionId (terminal: BaseTerminalTabComponent<any>): string {
        let id = this.terminalIds.get(terminal)
        if (!id) {
            id = `session-${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`
            this.terminalIds.set(terminal, id)
        }
        return id
    }

    private describeLocator (action: AITabbyToolAction): string {
        if (action.sessionId) {
            return action.sessionId
        }
        if (action.tabIndex !== undefined) {
            return `tabIndex=${action.tabIndex}`
        }
        if (action.title) {
            return `title=${action.title}`
        }
        return ''
    }

    private normalizeInput (input: string): string {
        if (input.includes('\x00')) {
            throw new Error('AI returned input with NUL bytes')
        }
        return input
    }

    private normalizeTarget (target: string): string {
        const normalized = target.trim()
        if (/[\r\n]/.test(normalized)) {
            throw new Error('AI returned a multi-line connection target')
        }
        if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(normalized)) {
            throw new Error('AI returned a connection target with terminal control characters')
        }
        return normalized
    }

    private normalizeRemotePath (remotePath?: string): string {
        const normalized = (remotePath ?? '').trim()
        if (!normalized) {
            throw new Error('Remote path is required')
        }
        if (/[\x00\r\n]/.test(normalized)) {
            throw new Error('AI returned an invalid remote path')
        }
        return normalized
    }
}
