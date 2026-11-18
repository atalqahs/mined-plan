import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';
import styles from './Button.module.css';
import './bevel.css';

type Variant = 'default' | 'primary' | 'quiet' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: IconName;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = 'default', size = 'md', icon, className, children, type = 'button', ...rest }, ref) {
  const cls = ['bevel', 'bevel-sm', styles.button, variant !== 'default' && styles[variant], size === 'sm' && styles.small, className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {icon ? <Icon name={icon} size={size === 'sm' ? 16 : 18} /> : null}
      {children}
    </button>
  );
});

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName;
  /** Required Arabic accessible label; also shown as the native tooltip. */
  label: string;
  shortcut?: string;
  active?: boolean;
  size?: 'md' | 'sm';
  badge?: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, shortcut, active, size = 'md', badge, className, type = 'button', ...rest }, ref) {
  const cls = ['bevel', 'bevel-sm', styles.button, styles.icon, size === 'sm' && styles.iconSmall, active && styles.active, className].filter(Boolean).join(' ');
  return (
    <button ref={ref} type={type} className={cls} aria-label={label} title={shortcut ? `${label} (${shortcut})` : label} aria-pressed={active === undefined ? undefined : active} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 16 : 19} />
      {badge}
    </button>
  );
});
