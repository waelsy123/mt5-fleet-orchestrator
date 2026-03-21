//+------------------------------------------------------------------+
//| PythonBridge.mq5 - File-based Python-to-MT5 bridge              |
//+------------------------------------------------------------------+
#property copyright "Python Bridge"
#property version   "1.00"

#include <Trade\Trade.mqh>

CTrade trade;

void OnInit()
{
   trade.SetExpertMagicNumber(123456);
   trade.SetDeviationInPoints(20);
   EventSetMillisecondTimer(200);  // Check every 200ms
   Print("PythonBridge EA started. Monitoring for commands...");
}

void OnTimer()
{
   if(!FileIsExist("command.txt"))
      return;

   int fh = FileOpen("command.txt", FILE_READ|FILE_TXT|FILE_ANSI);
   if(fh == INVALID_HANDLE)
      return;

   string line = FileReadString(fh);
   FileClose(fh);
   FileDelete("command.txt");

   if(StringLen(line) < 3)
      return;

   Print("Command received: ", line);
   ProcessCommand(line);
}

void ProcessCommand(string cmd)
{
   // Format: ACTION|SYMBOL|VOLUME|PRICE|SL|TP|COMMENT
   // Example: BUY|EURUSD|0.01|0|0|0|api-buy
   // Example: SELL|EURUSD|0.01|0|0|0|api-sell
   // Example: CLOSE|EURUSD|0|0|0|0|close-all
   // Example: INFO||||||| (account info)
   // Example: QUOTE|EURUSD||||| (get price)

   string parts[];
   int count = StringSplit(cmd, '|', parts);

   if(count < 1)
   {
      WriteResult("ERROR|Invalid command format");
      return;
   }

   string action = parts[0];

   if(action == "INFO")
   {
      if(!TerminalInfoInteger(TERMINAL_CONNECTED))
      {
         WriteResult("ERROR|Not connected to broker");
         return;
      }
      MqlTick tick;
      string symbol = (count > 1 && StringLen(parts[1]) > 0) ? parts[1] : "EURUSD";
      SymbolSelect(symbol, true);
      SymbolInfoTick(symbol, tick);

      string info = StringFormat("OK|login=%d|balance=%.2f|equity=%.2f|margin=%.2f|free_margin=%.2f|leverage=%d|server=%s|bid=%.5f|ask=%.5f",
         AccountInfoInteger(ACCOUNT_LOGIN),
         AccountInfoDouble(ACCOUNT_BALANCE),
         AccountInfoDouble(ACCOUNT_EQUITY),
         AccountInfoDouble(ACCOUNT_MARGIN),
         AccountInfoDouble(ACCOUNT_MARGIN_FREE),
         AccountInfoInteger(ACCOUNT_LEVERAGE),
         AccountInfoString(ACCOUNT_SERVER),
         tick.bid, tick.ask);
      WriteResult(info);
      return;
   }

   if(action == "QUOTE")
   {
      string symbol = (count > 1) ? parts[1] : "EURUSD";
      SymbolSelect(symbol, true);
      MqlTick tick;
      if(!SymbolInfoTick(symbol, tick))
      {
         WriteResult("ERROR|No tick for " + symbol);
         return;
      }
      WriteResult(StringFormat("OK|symbol=%s|bid=%.5f|ask=%.5f|time=%d", symbol, tick.bid, tick.ask, tick.time));
      return;
   }

   if(action == "BUY" || action == "SELL")
   {
      if(count < 3)
      {
         WriteResult("ERROR|Need at least ACTION|SYMBOL|VOLUME");
         return;
      }

      if(!TerminalInfoInteger(TERMINAL_CONNECTED))
      {
         WriteResult("ERROR|Not connected to broker");
         return;
      }

      if(!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
      {
         // Try anyway - the EA-level permission might be separate
         Print("Warning: TERMINAL_TRADE_ALLOWED is false, but attempting trade anyway");
      }

      string symbol = parts[1];
      double volume = StringToDouble(parts[2]);
      double sl = (count > 4) ? StringToDouble(parts[4]) : 0;
      double tp = (count > 5) ? StringToDouble(parts[5]) : 0;
      string comment = (count > 6) ? parts[6] : "python-api";

      SymbolSelect(symbol, true);

      // Determine filling mode
      long filling = SymbolInfoInteger(symbol, SYMBOL_FILLING_MODE);
      if((filling & SYMBOL_FILLING_IOC) != 0)
         trade.SetTypeFilling(ORDER_FILLING_IOC);
      else if((filling & SYMBOL_FILLING_FOK) != 0)
         trade.SetTypeFilling(ORDER_FILLING_FOK);
      else
         trade.SetTypeFilling(ORDER_FILLING_RETURN);

      MqlTick tick;
      if(!SymbolInfoTick(symbol, tick) || tick.ask <= 0)
      {
         WriteResult("ERROR|No price for " + symbol);
         return;
      }

      bool ok;
      if(action == "BUY")
         ok = trade.Buy(volume, symbol, tick.ask, sl, tp, comment);
      else
         ok = trade.Sell(volume, symbol, tick.bid, sl, tp, comment);

      if(ok)
      {
         WriteResult(StringFormat("OK|action=%s|deal=%d|order=%d|price=%.5f|volume=%.2f",
            action, trade.ResultDeal(), trade.ResultOrder(), trade.ResultPrice(), trade.ResultVolume()));
      }
      else
      {
         WriteResult(StringFormat("ERROR|retcode=%d|comment=%s", trade.ResultRetcode(), trade.ResultComment()));
      }
      return;
   }

   if(action == "CLOSE")
   {
      string symbol = (count > 1) ? parts[1] : "";
      int closed = 0;
      for(int i = PositionsTotal() - 1; i >= 0; i--)
      {
         ulong ticket = PositionGetTicket(i);
         if(ticket == 0) continue;
         if(StringLen(symbol) > 0 && PositionGetString(POSITION_SYMBOL) != symbol)
            continue;
         if(trade.PositionClose(ticket))
            closed++;
      }
      WriteResult(StringFormat("OK|closed=%d", closed));
      return;
   }

   if(action == "POSITIONS")
   {
      string result = "OK|count=" + IntegerToString(PositionsTotal());
      for(int i = 0; i < PositionsTotal(); i++)
      {
         ulong ticket = PositionGetTicket(i);
         if(ticket == 0) continue;
         result += StringFormat("|pos=%d;symbol=%s;type=%s;volume=%.2f;price=%.5f;profit=%.2f;sl=%.5f;tp=%.5f;comment=%s;time=%d;swap=%.2f;commission=%.2f",
            ticket,
            PositionGetString(POSITION_SYMBOL),
            (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL",
            PositionGetDouble(POSITION_VOLUME),
            PositionGetDouble(POSITION_PRICE_OPEN),
            PositionGetDouble(POSITION_PROFIT),
            PositionGetDouble(POSITION_SL),
            PositionGetDouble(POSITION_TP),
            PositionGetString(POSITION_COMMENT),
            PositionGetInteger(POSITION_TIME),
            PositionGetDouble(POSITION_SWAP),
            PositionGetDouble(POSITION_COMMISSION));
      }
      WriteResult(result);
      return;
   }

   // CLOSE_TICKET|ticket|volume (volume optional for partial close)
   if(action == "CLOSE_TICKET")
   {
      if(count < 2)
      {
         WriteResult("ERROR|Need CLOSE_TICKET|ticket[|volume]");
         return;
      }
      ulong ticket = (ulong)StringToInteger(parts[1]);
      if(!PositionSelectByTicket(ticket))
      {
         WriteResult("ERROR|Position not found: " + parts[1]);
         return;
      }

      bool ok;
      if(count > 2 && StringToDouble(parts[2]) > 0)
      {
         // Partial close
         double vol = StringToDouble(parts[2]);
         string sym = PositionGetString(POSITION_SYMBOL);
         long posType = PositionGetInteger(POSITION_TYPE);
         long filling = SymbolInfoInteger(sym, SYMBOL_FILLING_MODE);
         if((filling & SYMBOL_FILLING_IOC) != 0)
            trade.SetTypeFilling(ORDER_FILLING_IOC);
         else if((filling & SYMBOL_FILLING_FOK) != 0)
            trade.SetTypeFilling(ORDER_FILLING_FOK);
         else
            trade.SetTypeFilling(ORDER_FILLING_RETURN);

         MqlTick tick;
         SymbolInfoTick(sym, tick);
         if(posType == POSITION_TYPE_BUY)
            ok = trade.Sell(vol, sym, tick.bid, 0, 0, "partial_close");
         else
            ok = trade.Buy(vol, sym, tick.ask, 0, 0, "partial_close");
      }
      else
      {
         ok = trade.PositionClose(ticket);
      }

      if(ok)
         WriteResult(StringFormat("OK|ticket=%d|deal=%d|price=%.5f", ticket, trade.ResultDeal(), trade.ResultPrice()));
      else
         WriteResult(StringFormat("ERROR|retcode=%d|comment=%s", trade.ResultRetcode(), trade.ResultComment()));
      return;
   }

   // DEALS|days (default 30) — closed trade history
   if(action == "DEALS")
   {
      int days = (count > 1 && StringToInteger(parts[1]) > 0) ? (int)StringToInteger(parts[1]) : 30;
      datetime from = TimeCurrent() - days * 86400;
      datetime to = TimeCurrent();

      if(!HistorySelect(from, to))
      {
         WriteResult("ERROR|Failed to select history");
         return;
      }

      int total = HistoryDealsTotal();
      string result = "OK|count=" + IntegerToString(total);

      // Limit to last 500 deals to avoid oversized responses
      int start = (total > 500) ? total - 500 : 0;
      for(int i = start; i < total; i++)
      {
         ulong ticket = HistoryDealGetTicket(i);
         if(ticket == 0) continue;

         long entry = HistoryDealGetInteger(ticket, DEAL_ENTRY);
         // entry: 0=IN, 1=OUT, 2=INOUT, 3=OUT_BY
         string entryStr = "IN";
         if(entry == 1) entryStr = "OUT";
         else if(entry == 2) entryStr = "INOUT";
         else if(entry == 3) entryStr = "OUT_BY";

         long dealType = HistoryDealGetInteger(ticket, DEAL_TYPE);
         string typeStr = "OTHER";
         if(dealType == DEAL_TYPE_BUY) typeStr = "BUY";
         else if(dealType == DEAL_TYPE_SELL) typeStr = "SELL";
         else if(dealType == DEAL_TYPE_BALANCE) typeStr = "BALANCE";
         else if(dealType == DEAL_TYPE_CREDIT) typeStr = "CREDIT";
         else if(dealType == DEAL_TYPE_COMMISSION) typeStr = "COMMISSION";

         result += StringFormat("|deal=%d;order=%d;symbol=%s;type=%s;entry=%s;volume=%.2f;price=%.5f;profit=%.2f;swap=%.2f;commission=%.2f;comment=%s;time=%d;position=%d",
            ticket,
            HistoryDealGetInteger(ticket, DEAL_ORDER),
            HistoryDealGetString(ticket, DEAL_SYMBOL),
            typeStr,
            entryStr,
            HistoryDealGetDouble(ticket, DEAL_VOLUME),
            HistoryDealGetDouble(ticket, DEAL_PRICE),
            HistoryDealGetDouble(ticket, DEAL_PROFIT),
            HistoryDealGetDouble(ticket, DEAL_SWAP),
            HistoryDealGetDouble(ticket, DEAL_COMMISSION),
            HistoryDealGetString(ticket, DEAL_COMMENT),
            HistoryDealGetInteger(ticket, DEAL_TIME),
            HistoryDealGetInteger(ticket, DEAL_POSITION_ID));
      }
      WriteResult(result);
      return;
   }

   WriteResult("ERROR|Unknown action: " + action);
}

void WriteResult(string result)
{
   Print("Result: ", result);
   int fh = FileOpen("result.txt", FILE_WRITE|FILE_TXT|FILE_ANSI);
   if(fh != INVALID_HANDLE)
   {
      FileWriteString(fh, result);
      FileClose(fh);
   }
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   Print("PythonBridge EA stopped.");
}

void OnTick() {}
