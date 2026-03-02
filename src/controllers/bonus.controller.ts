import { Request, Response } from 'express';
import { BonusService } from '../services/bonus.service';

export const spendUserBonus = async (req: Request, res: Response) => {
  try {
    const { amount } = req.body as { amount: number };
    const userId = req.params.id;

    const requestId =
      req.header('Idempotency-Key') ??
      req.header('idempotency-key') ??
      (req.body as any).requestId ??
      (req.body as any).request_id;

    if (!requestId) {
      return res.status(400).json({ message: 'Missing Idempotency-Key' });
    }

    const result = await BonusService.spendBonus(userId, amount, requestId);

    return res.status(200).json(result);
  } catch (err: any) {
    if (err?.message === 'Not enough bonus') {
      return res.status(400).json({ message: err.message });
    }

    return res.status(500).json({ message: err?.message ?? 'Internal error' });
  }
};

export const enqueueExpireAccrualsJob = async (
  _req: Request,
  res: Response,
) => {
  try {
    const result = await BonusService.processExpiredBonuses();
    return res.status(200).json(result);
  } catch (err: any) {
    return res.status(500).json({ message: err?.message ?? 'Internal error' });
  }
};