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

export { Kbd } from './Kbd'

export { PageContainer } from './PageContainer'
export type { PageWidth } from './PageContainer'

export { PageHeader } from './PageHeader'

export { Field, Input, Textarea, Select, Checkbox, RadioGroup } from './Field'
export type { FieldProps, InputProps, RadioOption, SelectProps } from './Field'

export { SearchInput } from './SearchInput'
export type { SearchInputProps } from './SearchInput'

export { BarcodeInput } from './BarcodeInput'
export type { BarcodeInputProps, BarcodeStatus } from './BarcodeInput'

export { ScannerInput } from './ScannerInput'
export type { ScannerInputProps, TeclaDelLector } from './ScannerInput'

export { QuantityInput } from './QuantityInput'
export { NumericInput, problemaDeCantidad, problemaDeImporte } from './NumericInput'
export type { NumericInputProps, ModoNumerico } from './NumericInput'

export { QuantityText, formatQuantity } from './QuantityText'
export type { QuantityTextProps, UnidadDeCantidad } from './QuantityText'

export { Money, MoneyText, formatMoney, tonoPorSigno } from './Money'
export type { MoneyProps, MoneySize, MoneyTone } from './Money'

export { MoneyInput } from './MoneyInput'
export type { MoneyInputProps, MoneyInputSize } from './MoneyInput'

export { Badge, StatusBadge, SaleStatusBadge, StockBadge } from './Badge'
export type { BadgeTone } from './Badge'

export { EstadoBadge, describirEstado } from './EstadoBadge'
export type { DominioDeEstado } from './EstadoBadge'

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

export { ResponsiveData, useEsEscritorio, CONSULTA_ESCRITORIO } from './ResponsiveData'

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
