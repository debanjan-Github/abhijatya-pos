export interface PrinterStatus { connected: boolean; detail?: string }
export interface PrinterService {
  connect(): Promise<void>
  disconnect(): Promise<void>
  getStatus(): Promise<PrinterStatus>
  printLabel(): Promise<void>
  printReceipt(): Promise<void>
  testPrint(): Promise<void>
}

// NEEDS VERIFICATION: implement only after PSF-58D iOS protocol/SDK confirmation.
export class UnsupportedPsf58dPrinterService implements PrinterService {
  async connect() { throw new Error('PSF-58D iOS protocol has not yet been verified.') }
  async disconnect() { return }
  async getStatus() { return { connected: false, detail: 'Hardware adapter pending manufacturer documentation.' } }
  async printLabel() { throw new Error('Label printing is not configured.') }
  async printReceipt() { throw new Error('Receipt printing is not configured.') }
  async testPrint() { throw new Error('Printer test is not configured.') }
}
