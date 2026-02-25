import { describe, it, expect } from 'vitest';
import { extractSymbols, type ExtractedSymbol } from '../../src/indexer/symbols.js';

describe('extractSymbols', () => {
  // ========================================================================
  // TypeScript / JavaScript
  // ========================================================================
  describe('TypeScript/JavaScript', () => {
    it('should extract function declarations', () => {
      const code = `
function hello(name: string): string {
  return \`Hello, \${name}!\`;
}

export async function fetchData(url: string): Promise<Response> {
  return fetch(url);
}
`;
      const symbols = extractSymbols(code, 'typescript');
      const names = symbols.map(s => s.name);
      expect(names).toContain('hello');
      expect(names).toContain('fetchData');

      const hello = symbols.find(s => s.name === 'hello')!;
      expect(hello.kind).toBe('function');
      expect(hello.lineStart).toBeGreaterThan(0);
      expect(hello.lineEnd).not.toBeNull();
    });

    it('should extract arrow functions', () => {
      const code = `
export const add = (a: number, b: number) => a + b;
const multiply = (a: number, b: number) => {
  return a * b;
};
`;
      const symbols = extractSymbols(code, 'typescript');
      const names = symbols.map(s => s.name);
      expect(names).toContain('add');
      expect(names).toContain('multiply');
    });

    it('should extract classes', () => {
      const code = `
export class MyService {
  private data: string[];

  constructor() {
    this.data = [];
  }

  getData(): string[] {
    return this.data;
  }
}

abstract class BaseHandler {
  abstract handle(): void;
}
`;
      const symbols = extractSymbols(code, 'typescript');
      const classes = symbols.filter(s => s.kind === 'class');
      expect(classes.map(c => c.name)).toContain('MyService');
      expect(classes.map(c => c.name)).toContain('BaseHandler');

      const methods = symbols.filter(s => s.kind === 'method');
      expect(methods.map(m => m.name)).toContain('getData');
    });

    it('should extract interfaces and types', () => {
      const code = `
export interface UserData {
  id: string;
  name: string;
}

export type UserId = string | number;

interface InternalConfig {
  debug: boolean;
}
`;
      const symbols = extractSymbols(code, 'typescript');
      const interfaces = symbols.filter(s => s.kind === 'interface');
      expect(interfaces.map(i => i.name)).toContain('UserData');
      expect(interfaces.map(i => i.name)).toContain('InternalConfig');

      const types = symbols.filter(s => s.kind === 'type');
      expect(types.map(t => t.name)).toContain('UserId');
    });

    it('should extract enums', () => {
      const code = `
export enum Color {
  Red = 'red',
  Blue = 'blue',
}

const enum Direction {
  Up,
  Down,
}
`;
      const symbols = extractSymbols(code, 'typescript');
      const enums = symbols.filter(s => s.kind === 'enum');
      expect(enums.map(e => e.name)).toContain('Color');
      expect(enums.map(e => e.name)).toContain('Direction');
    });

    it('should extract exported consts', () => {
      const code = `
export const MAX_SIZE = 1024;
export const config: Config = { debug: true };
`;
      const symbols = extractSymbols(code, 'typescript');
      const consts = symbols.filter(s => s.kind === 'const');
      expect(consts.map(c => c.name)).toContain('MAX_SIZE');
      expect(consts.map(c => c.name)).toContain('config');
    });

    it('should extract JSDoc comments', () => {
      const code = `
/**
 * Add two numbers.
 * @param a First number
 * @param b Second number
 */
function add(a: number, b: number): number {
  return a + b;
}
`;
      const symbols = extractSymbols(code, 'typescript');
      const add = symbols.find(s => s.name === 'add')!;
      expect(add.docComment).toContain('Add two numbers');
    });

    it('should not extract false positives from control flow', () => {
      const code = `
class MyClass {
  doSomething() {
    if (true) {
      return 1;
    }
    for (const x of items) {
      console.log(x);
    }
    while (running) {
      process();
    }
  }
}
`;
      const symbols = extractSymbols(code, 'typescript');
      const names = symbols.map(s => s.name);
      expect(names).not.toContain('if');
      expect(names).not.toContain('for');
      expect(names).not.toContain('while');
      expect(names).not.toContain('return');
    });

    it('should also work for javascript', () => {
      const code = `
function greet(name) {
  return "Hello " + name;
}
`;
      const symbols = extractSymbols(code, 'javascript');
      expect(symbols.map(s => s.name)).toContain('greet');
    });
  });

  // ========================================================================
  // Python
  // ========================================================================
  describe('Python', () => {
    it('should extract functions and classes', () => {
      const code = `
def hello(name):
    return f"Hello, {name}!"

async def fetch_data(url):
    async with aiohttp.ClientSession() as session:
        return await session.get(url)

class UserService:
    def __init__(self):
        self.users = []

    def get_user(self, id):
        return self.users[id]
`;
      const symbols = extractSymbols(code, 'python');
      const names = symbols.map(s => s.name);
      expect(names).toContain('hello');
      expect(names).toContain('fetch_data');
      expect(names).toContain('UserService');
      expect(names).toContain('__init__');
      expect(names).toContain('get_user');

      const methods = symbols.filter(s => s.kind === 'method');
      expect(methods.map(m => m.name)).toContain('__init__');
      expect(methods.map(m => m.name)).toContain('get_user');
    });

    it('should extract Python docstrings', () => {
      const code = `
def calculate(x, y):
    """Calculate the sum of x and y."""
    return x + y
`;
      const symbols = extractSymbols(code, 'python');
      const calc = symbols.find(s => s.name === 'calculate')!;
      expect(calc.docComment).toContain('Calculate the sum');
    });

    it('should handle indentation-based line end', () => {
      const code = `
def outer():
    x = 1
    y = 2
    return x + y

def next_func():
    pass
`;
      const symbols = extractSymbols(code, 'python');
      const outer = symbols.find(s => s.name === 'outer')!;
      expect(outer.lineEnd).toBeDefined();
      expect(outer.lineEnd!).toBeLessThan(symbols.find(s => s.name === 'next_func')!.lineStart);
    });
  });

  // ========================================================================
  // Rust
  // ========================================================================
  describe('Rust', () => {
    it('should extract fn, struct, enum, trait, impl', () => {
      const code = `
pub fn process(data: &[u8]) -> Result<(), Error> {
    Ok(())
}

pub struct Config {
    pub debug: bool,
    pub name: String,
}

pub enum Status {
    Active,
    Inactive,
}

pub trait Handler {
    fn handle(&self) -> Result<()>;
}

impl Config {
    pub fn new() -> Self {
        Config { debug: false, name: String::new() }
    }
}
`;
      const symbols = extractSymbols(code, 'rust');
      const names = symbols.map(s => s.name);
      expect(names).toContain('process');
      expect(names).toContain('Config');
      expect(names).toContain('Status');
      expect(names).toContain('Handler');

      expect(symbols.find(s => s.name === 'Config' && s.kind === 'class')).toBeDefined();
      expect(symbols.find(s => s.name === 'Status')!.kind).toBe('enum');
      expect(symbols.find(s => s.name === 'Handler')!.kind).toBe('interface');
    });

    it('should extract Rust doc comments', () => {
      const code = `
/// Process incoming data.
/// Returns Ok on success.
pub fn process(data: &[u8]) -> Result<(), Error> {
    Ok(())
}
`;
      const symbols = extractSymbols(code, 'rust');
      const process = symbols.find(s => s.name === 'process')!;
      expect(process.docComment).toContain('Process incoming data');
    });
  });

  // ========================================================================
  // Go
  // ========================================================================
  describe('Go', () => {
    it('should extract func, type struct, type interface', () => {
      const code = `
func main() {
    fmt.Println("Hello")
}

func (s *Server) Start() error {
    return nil
}

type Config struct {
    Debug bool
    Name  string
}

type Handler interface {
    Handle() error
}
`;
      const symbols = extractSymbols(code, 'go');
      const names = symbols.map(s => s.name);
      expect(names).toContain('main');
      expect(names).toContain('Start');
      expect(names).toContain('Config');
      expect(names).toContain('Handler');

      expect(symbols.find(s => s.name === 'Start')!.kind).toBe('method');
      expect(symbols.find(s => s.name === 'Config')!.kind).toBe('class');
      expect(symbols.find(s => s.name === 'Handler')!.kind).toBe('interface');
    });
  });

  // ========================================================================
  // Java (Tier 2)
  // ========================================================================
  describe('Java', () => {
    it('should extract classes and interfaces', () => {
      const code = `
public class UserService {
    private List<User> users;

    public User getUser(int id) {
        return users.get(id);
    }
}

public interface Repository {
    void save(Object entity);
}
`;
      const symbols = extractSymbols(code, 'java');
      expect(symbols.find(s => s.name === 'UserService' && s.kind === 'class')).toBeDefined();
      expect(symbols.find(s => s.name === 'Repository' && s.kind === 'interface')).toBeDefined();
    });
  });

  // ========================================================================
  // Ruby (Tier 2)
  // ========================================================================
  describe('Ruby', () => {
    it('should extract classes and methods', () => {
      const code = `
class UserController
  def index
    @users = User.all
  end

  def show
    @user = User.find(params[:id])
  end
end
`;
      const symbols = extractSymbols(code, 'ruby');
      expect(symbols.find(s => s.name === 'UserController' && s.kind === 'class')).toBeDefined();
      expect(symbols.find(s => s.name === 'index')).toBeDefined();
      expect(symbols.find(s => s.name === 'show')).toBeDefined();
    });
  });

  // ========================================================================
  // C/C++ (Tier 2)
  // ========================================================================
  describe('C/C++', () => {
    it('should extract classes, structs, and functions', () => {
      const code = `
class MyWidget {
public:
    void draw();
    int getWidth();
};

struct Point {
    int x;
    int y;
};

void processInput(const char* input) {
    // ...
}
`;
      const symbols = extractSymbols(code, 'cpp');
      expect(symbols.find(s => s.name === 'MyWidget' && s.kind === 'class')).toBeDefined();
      expect(symbols.find(s => s.name === 'Point' && s.kind === 'class')).toBeDefined();
      expect(symbols.find(s => s.name === 'processInput' && s.kind === 'function')).toBeDefined();
    });
  });

  // ========================================================================
  // Unsupported languages
  // ========================================================================
  describe('Unsupported', () => {
    it('should return empty for unknown languages', () => {
      const symbols = extractSymbols('some content here', 'brainfuck');
      expect(symbols).toEqual([]);
    });
  });
});
