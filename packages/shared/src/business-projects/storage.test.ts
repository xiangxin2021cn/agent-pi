import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createBusinessProject,
  listBusinessProjects,
  registerBusinessProjectInputs,
  unregisterBusinessProject,
} from './storage.ts'

describe('business project registry', () => {
  let root = ''
  let workspaceRoot = ''
  let projectRoot = ''

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'agent-pi-business-projects-'))
    workspaceRoot = join(root, 'workspace')
    projectRoot = join(root, 'projects', 'n3-bid')
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  test('creates a project directory, registry pointer, and project-local shell manifest', () => {
    const project = createBusinessProject({
      workspaceRootPath: workspaceRoot,
      module: 'tender',
      projectId: 'n3-bid',
      name: 'N3 Bid',
      rootPath: projectRoot,
      createDirectory: true,
      workflowId: 'tender-main',
      inputPaths: [join(root, 'Tender.pdf')],
    })

    expect(project.module).toBe('tender')
    expect(project.rootPath).toBe(projectRoot)
    expect(listBusinessProjects(workspaceRoot, 'tender')).toEqual([project])

    const manifestPath = join(projectRoot, '.agent-pi', 'business', 'tender', 'n3-bid', 'project-shell.json')
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    expect(manifest.inputPaths).toEqual([join(root, 'Tender.pdf')])
  })

  test('keeps modules independent while allowing the same physical root', () => {
    createBusinessProject({ workspaceRootPath: workspaceRoot, module: 'tender', projectId: 'shared', name: 'Tender', rootPath: projectRoot, createDirectory: true, workflowId: 'tender-main' })
    createBusinessProject({ workspaceRootPath: workspaceRoot, module: 'delivery', projectId: 'shared', name: 'Delivery', rootPath: projectRoot, createDirectory: false, workflowId: 'delivery-main' })

    expect(listBusinessProjects(workspaceRoot, 'tender')).toHaveLength(1)
    expect(listBusinessProjects(workspaceRoot, 'delivery')).toHaveLength(1)
    expect(listBusinessProjects(workspaceRoot, 'investment')).toHaveLength(0)
  })

  test('persists explicit input paths without scanning the project directory', () => {
    createBusinessProject({ workspaceRootPath: workspaceRoot, module: 'investment', projectId: 'quarry', name: 'Quarry', rootPath: projectRoot, createDirectory: true, workflowId: 'investment-main' })
    const updated = registerBusinessProjectInputs(workspaceRoot, 'investment', 'quarry', [join(root, 'model.xlsx'), join(root, 'report.pdf')])

    expect(updated.inputPaths).toEqual([join(root, 'model.xlsx'), join(root, 'report.pdf')])
    expect(listBusinessProjects(workspaceRoot, 'investment')[0]?.inputPaths).toEqual(updated.inputPaths)
  })

  test('unregisters the pointer without deleting the user project directory', () => {
    createBusinessProject({ workspaceRootPath: workspaceRoot, module: 'delivery', projectId: 'site', name: 'Site', rootPath: projectRoot, createDirectory: true, workflowId: 'delivery-main' })

    unregisterBusinessProject(workspaceRoot, 'delivery', 'site')

    expect(listBusinessProjects(workspaceRoot, 'delivery')).toEqual([])
    expect(existsSync(projectRoot)).toBe(true)
  })

  test('rejects unsafe IDs and relative paths', () => {
    expect(() => createBusinessProject({ workspaceRootPath: workspaceRoot, module: 'tender', projectId: '../escape', name: 'Bad', rootPath: projectRoot, createDirectory: true, workflowId: 'tender-main' })).toThrow('Invalid business project ID')
    expect(() => createBusinessProject({ workspaceRootPath: workspaceRoot, module: 'tender', projectId: 'bad-root', name: 'Bad', rootPath: 'relative/project', createDirectory: true, workflowId: 'tender-main' })).toThrow('rootPath must be absolute')
  })
})
