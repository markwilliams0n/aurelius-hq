import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';

const LIFE_DIR = path.join(process.cwd(), 'life');
const MEMORY_DIR = path.join(process.cwd(), 'memory');

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  const relativePath = pathSegments.join('/');

  // Determine if this is a life/ or memory/ path
  const isMemory = relativePath.startsWith('daily/');
  const baseDir = isMemory ? MEMORY_DIR : LIFE_DIR;
  const actualPath = isMemory ? relativePath.replace('daily/', '') : relativePath;

  const fullPath = path.join(baseDir, actualPath);

  // Security: ensure we're not escaping the base directories
  if (!fullPath.startsWith(LIFE_DIR) && !fullPath.startsWith(MEMORY_DIR)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 });
  }

  try {
    const stat = await fs.stat(fullPath);

    if (stat.isDirectory()) {
      // Return directory contents
      const items = await fs.readdir(fullPath, { withFileTypes: true });
      const contents = await Promise.all(
        items
          .filter(i => !i.name.startsWith('.'))
          .map(async (item) => {
            const itemPath = path.join(fullPath, item.name);
            let preview: string | null = null;

            // For entity directories, try to get summary preview
            if (item.isDirectory()) {
              try {
                const summaryPath = path.join(itemPath, 'summary.md');
                const summaryContent = await fs.readFile(summaryPath, 'utf-8');
                const match = summaryContent.match(/## Summary\n\n([\s\S]*?)(?=\n##|$)/);
                preview = match ? match[1].trim().slice(0, 100) : null;
              } catch {
                // No summary
              }
            }

            return {
              name: item.name,
              isDirectory: item.isDirectory(),
              preview,
            };
          })
      );

      return NextResponse.json({
        type: 'directory',
        path: relativePath,
        items: contents,
      });
    } else {
      // Return file contents
      const content = await fs.readFile(fullPath, 'utf-8');
      const isJson = fullPath.endsWith('.json');
      const isMd = fullPath.endsWith('.md');

      return NextResponse.json({
        type: 'file',
        path: relativePath,
        format: isJson ? 'json' : isMd ? 'markdown' : 'text',
        content: isJson ? JSON.parse(content) : content,
      });
    }
  } catch (error) {
    console.error('Browse error:', error);
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
