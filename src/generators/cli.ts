import {execSync} from 'child_process'
import * as fs from 'fs'
import * as _ from 'lodash'
import * as path from 'path'
import * as Generator from 'yeoman-generator'
import yosay = require('yosay')

const sortPjson = require('sort-pjson')
const fixpack = require('@oclif/fixpack')
const debug = require('debug')('generator-oclif')
const {version} = require('../../package.json')

const isWindows = process.platform === 'win32'

let hasYarn = false
try {
  execSync('yarn -v', {stdio: 'ignore'})
  hasYarn = true
} catch {}

class App extends Generator {
  options: {
    defaults?: boolean;
    yarn: boolean;
  }

  args!: {[k: string]: string}

  name: string

  pjson: any

  githubUser: string | undefined

  answers!: {
    name: string;
    bin: string;
    description: string;
    version: string;
    github: {repo: string; user: string};
    author: string;
    files: string;
    license: string;
    pkg: string;
    typescript: boolean;
    eslint: boolean;
    mocha: boolean;
    ci: {
      circleci: boolean;
      appveyor: boolean;
      travisci: boolean;
    };
  }

  yarn!: boolean

  repository?: string

  constructor(args: string | string[], opts: Generator.GeneratorOptions) {
    super(args, opts)

    this.name = opts.name
    this.options = {
      defaults: opts.defaults,
      yarn: hasYarn,
    }
  }

  async prompting(): Promise<void> {
    const msg = 'Time to build an oclif CLI!'

    this.log(yosay(`${msg} Version: ${version}`))

    execSync(`git clone https://github.com/oclif/hello-world.git ${path.resolve(this.name)}`)
    fs.rmdirSync(`${path.resolve(this.name, '.git')}`, {recursive: true})

    this.destinationRoot(path.resolve(this.name))
    process.chdir(this.destinationRoot())

    this.githubUser = await this.user.github.username().catch(debug)
    this.pjson = {
      scripts: {},
      engines: {},
      devDependencies: {},
      dependencies: {},
      oclif: {},
      ...(this.fs.readJSON('package.json', {}) as Record<string, unknown>),
    }
    let repository = this.destinationRoot().split(path.sep).slice(-2).join('/')
    if (this.githubUser) repository = `${this.githubUser}/${repository.split('/')[1]}`
    const defaults = {
      name: this.determineAppname().replace(/ /g, '-'),
      version: '0.0.0',
      license: 'MIT',
      author: this.githubUser ? `${this.user.git.name()} @${this.githubUser}` : this.user.git.name(),
      dependencies: {},
      repository,
      ...this.pjson,
      engines: {
        node: '>=8.0.0',
        ...this.pjson.engines,
      },
      options: this.options,
    }
    this.repository = defaults.repository
    if (this.repository && (this.repository as any).url) {
      this.repository = (this.repository as any).url
    }

    if (this.options.defaults) {
      this.answers = defaults
    } else {
      this.answers = await this.prompt([
        {
          type: 'input',
          name: 'name',
          message: 'npm package name',
          default: defaults.name,
        },
        {
          type: 'input',
          name: 'bin',
          message: 'command bin name the CLI will export',
          default: (answers: any) => answers.name,
        },
        {
          type: 'input',
          name: 'description',
          message: 'description',
          default: defaults.description,
        },
        {
          type: 'input',
          name: 'author',
          message: 'author',
          default: defaults.author,
        },
        {
          type: 'input',
          name: 'version',
          message: 'version',
          default: defaults.version,
          when: !this.pjson.version,
        },
        {
          type: 'input',
          name: 'license',
          message: 'license',
          default: defaults.license,
        },
        {
          type: 'input',
          name: 'github.user',
          message: 'Who is the GitHub owner of repository (https://github.com/OWNER/repo)',
          default: repository.split('/').slice(0, -1).pop(),
        },
        {
          type: 'input',
          name: 'github.repo',
          message: 'What is the GitHub name of repository (https://github.com/owner/REPO)',
          default: (answers: any) => (this.pjson.repository || answers.name || this.pjson.name).split('/').pop(),
        },
        {
          type: 'list',
          name: 'pkg',
          message: 'Select a package manager',
          choices: [
            {name: 'npm', value: 'npm'},
            {name: 'yarn', value: 'yarn'},
          ],
          default: () => this.options.yarn || hasYarn ? 1 : 0,
        },
      ]) as any
    }

    debug(this.answers)
    if (!this.options.defaults) {
      this.options = {
        ...this.answers.ci,
        yarn: this.answers.pkg === 'yarn',
      }
    }

    this.yarn = this.options.yarn

    this.pjson.name = this.answers.name || defaults.name
    this.pjson.description = this.answers.description || defaults.description
    this.pjson.version = this.answers.version || defaults.version
    this.pjson.engines.node = defaults.engines.node
    this.pjson.author = this.answers.author || defaults.author
    this.pjson.files = this.answers.files || defaults.files || '/lib'
    this.pjson.license = this.answers.license || defaults.license
    // eslint-disable-next-line no-multi-assign
    this.repository = this.pjson.repository = this.answers.github ? `${this.answers.github.user}/${this.answers.github.repo}` : defaults.repository

    this.pjson.homepage = `https://github.com/${this.repository}`
    this.pjson.bugs = `https://github.com/${this.repository}/issues`

    this.pjson.oclif.bin = this.answers.bin
    this.pjson.bin = {}
    this.pjson.bin[this.pjson.oclif.bin] = './bin/run'
  }

  writing(): void {
    if (this.pjson.oclif && Array.isArray(this.pjson.oclif.plugins)) {
      this.pjson.oclif.plugins.sort()
    }

    if (this.fs.exists(this.destinationPath('./package.json'))) {
      fixpack(this.destinationPath('./package.json'), require('@oclif/fixpack/config.json'))
    }

    if (_.isEmpty(this.pjson.oclif)) delete this.pjson.oclif
    this.pjson.files = _.uniq((this.pjson.files || []).sort())
    this.fs.writeJSON(this.destinationPath('./package.json'), sortPjson(this.pjson))

    this.fs.write(this.destinationPath('.gitignore'), this._gitignore())
  }

  async install(): Promise<void> {
    const dependencies: string[] = []
    const devDependencies: string[] = []
    if (isWindows) devDependencies.push('rimraf')
    const yarnOpts = {} as any
    if (process.env.YARN_MUTEX) yarnOpts.mutex = process.env.YARN_MUTEX
    const install = (deps: string[], opts: Record<string, unknown>) => this.yarn ? this.yarnInstall(deps, opts) : this.npmInstall(deps, opts)
    const dev = this.yarn ? {dev: true} : {'save-dev': true}
    const save = this.yarn ? {} : {save: true}
    return Promise.all([
      install(devDependencies, {...yarnOpts, ...dev, ignoreScripts: true}),
      install(dependencies, {...yarnOpts, ...save}),
    ]).then(() => {})
  }

  end(): void {
    this.spawnCommandSync(path.join('.', 'node_modules/.bin/oclif'), ['readme'])
    console.log(`\nCreated ${this.pjson.name} in ${this.destinationRoot()}`)
  }

  private _gitignore(): string {
    const existing = this.fs.exists(this.destinationPath('.gitignore')) ? this.fs.read(this.destinationPath('.gitignore')).split('\n') : []
    return _([
      '*-debug.log',
      '*-error.log',
      'node_modules',
      '/tmp',
      '/dist',
      this.yarn ? '/package-lock.json' : '/yarn.lock',
      '/lib',
    ])
    .concat(existing)
    .compact()
    .uniq()
    .sort()
    .join('\n') + '\n'
  }
}

export = App
