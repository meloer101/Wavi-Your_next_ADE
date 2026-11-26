// 任务看板's IPC in main (PRD F9 v1.249): the TaskBoard (./store.ts) owns `<userData>/tasks.json`; the windows reach it
// only through these handlers (`window.tr.tasks`), and `wavi task` goes through the window's handler to the same ones.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { TASK_IPC, type Task } from '@shared/task-board'
import { getMainWindow } from '../windows'
import { parseTaskDraft, parseTaskId, parseTaskPatch, parseTaskSnapshot } from './parse'
import { TaskBoard, TasksFile } from './store'

const isMainPage = (event: IpcMainInvokeEvent): boolean => event.sender === getMainWindow()?.webContents

function publish(tasks: Task[]): void {
  const page = getMainWindow()?.webContents
  if (page && !page.isDestroyed()) page.send(TASK_IPC.changed, tasks)
}

export function registerTaskHandlers(): void {
  const board = new TaskBoard(new TasksFile(join(app.getPath('userData'), 'tasks.json')), { now: () => Date.now(), newId: () => randomUUID(), changed: publish })
  const handle = (channel: string, action: (...args: unknown[]) => unknown): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) => {
      if (!isMainPage(event)) throw new Error('not the main window')
      return action(...args)
    })
  }
  handle(TASK_IPC.list, () => board.list())
  handle(TASK_IPC.create, (raw) => {
    const draft = parseTaskDraft(raw)
    return draft ? board.create(draft) : null
  })
  handle(TASK_IPC.update, (id, raw) => {
    const patch = parseTaskPatch(raw)
    return patch ? board.update(parseTaskId(id), patch) : null
  })
  handle(TASK_IPC.remove, (id) => board.remove(parseTaskId(id)))
  handle(TASK_IPC.restore, (raw) => {
    const cards = parseTaskSnapshot(raw)
    return cards ? board.restore(cards) : false
  })
}
