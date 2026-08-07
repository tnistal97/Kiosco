/**
 * Biblioteca de interfaz del almacen.
 *
 * Todo lo visual sale de aca. Una pantalla que necesita un control nuevo
 * agrega el componente a esta carpeta; no lo dibuja con clases sueltas.
 * Es lo que hace que el sistema se vea igual en todas partes y que un cambio
 * de tono se haga en un solo lugar.
 */

export { cn } from './cn'

export { Button, ButtonLink, IconButton, Spinner } from './Button'
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './Button'

export { Field, Input, Textarea, Select, Checkbox, RadioGroup } from './Field'
export type { FieldProps, InputProps, RadioOption, SelectProps } from './Field'

export { SearchInput } from './SearchInput'
export type { SearchInputProps } from './SearchInput'

export { BarcodeInput } from './BarcodeInput'
export type { BarcodeInputProps, BarcodeStatus } from './BarcodeInput'

export { QuantityInput } from './QuantityInput'

export { Money, formatMoney } from './Money'
export type { MoneyProps, MoneySize, MoneyTone } from './Money'

export { Badge, StatusBadge, SaleStatusBadge, StockBadge } from './Badge'
export type { BadgeTone } from './Badge'

export { Card, CardHeader, MetricCard } from './Card'

export {
  Table,
  TableWrap,
  THead,
  TBody,
  TR,
  TH,
  TD,
  SortableTH,
  CardList,
  CardListItem,
} from './Table'

export { Pagination } from './Pagination'

export { EmptyState, ErrorState, Skeleton, SkeletonRows } from './States'

export { Alert } from './Alert'
export type { AlertTone } from './Alert'

export { Dialog, ConfirmationDialog } from './Dialog'
export type { DialogProps, DialogSize } from './Dialog'

export { Drawer } from './Drawer'

export { DropdownMenu, DropdownItem, DropdownLabel, DropdownSeparator } from './DropdownMenu'

export { Tooltip } from './Tooltip'

export { aviso, ToastViewport } from './toast'
