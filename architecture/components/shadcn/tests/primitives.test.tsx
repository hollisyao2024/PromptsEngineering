import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';

describe('shadcn dependency compatibility', () => {
  it('keeps project cn imports and conditional Tailwind conflict resolution compatible', () => {
    expect(cn('p-2 text-sm', false, ['p-4', { hidden: false, block: true }], null)).toBe('text-sm p-4 block');
    expect(cn('hover:bg-red-500', 'hover:bg-blue-500', 'bg-white')).toBe('hover:bg-blue-500 bg-white');
  });

  it('opens a Radix dialog through a composed Button and restores keyboard focus', async () => {
    const user = userEvent.setup();
    render(<Dialog><DialogTrigger asChild><Button>新增记录</Button></DialogTrigger><DialogContent><DialogTitle>记录</DialogTitle><DialogDescription>填写名称</DialogDescription><Input aria-label="名称" /></DialogContent></Dialog>);
    const trigger = screen.getByRole('button', { name: '新增记录' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeVisible();
    await user.type(screen.getByRole('textbox', { name: '名称' }), '测试');
    expect(screen.getByRole('textbox')).toHaveValue('测试');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('supports controlled selection and toggles with the current React and Radix versions', async () => {
    const user = userEvent.setup();
    function Controls() {
      const [value, setValue] = useState('active');
      return <><Select value={value} onValueChange={setValue}><SelectTrigger aria-label="状态"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="active">启用</SelectItem><SelectItem value="paused">暂停</SelectItem></SelectContent></Select><Switch aria-label="通知" /><Checkbox aria-label="锁定" disabled /></>;
    }
    render(<Controls />);
    await user.click(screen.getByRole('combobox', { name: '状态' }));
    await user.click(screen.getByRole('option', { name: '暂停' }));
    expect(screen.getByRole('combobox')).toHaveTextContent('暂停');
    await user.click(screen.getByRole('switch', { name: '通知' }));
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getByRole('checkbox', { name: '锁定' })).toBeDisabled();
  });
});
