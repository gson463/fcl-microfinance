import { add } from 'date-fns';
import { toZonedTime, formatInTimeZone } from 'date-fns-tz';

const EAT_TIMEZONE = 'Africa/Nairobi';

/** Calendar yyyy-MM-dd in Africa/Nairobi (not UTC midnight from toISOString). */
function formatYmdEAT(date) {
    return formatInTimeZone(date, EAT_TIMEZONE, 'yyyy-MM-dd');
}

/** ISO weekday in EAT: 1 = Monday … 7 = Sunday (date-fns token `i`). */
function isoWeekdayEAT(date) {
    return formatInTimeZone(date, EAT_TIMEZONE, 'i');
}

const addPeriod = (date, count, unit) => {
    switch (unit) {
        case 'daily': return add(date, { days: count });
        case 'weekly': return add(date, { weeks: count });
        case 'biweekly': return add(date, { weeks: count * 2 });
        case 'monthly': return add(date, { months: count });
        default: return date;
    }
};

export const getNextWorkingDay = (date, holidays = []) => {
    const asDate = date instanceof Date ? date : new Date(date);
    let currentCheckDate = toZonedTime(asDate, EAT_TIMEZONE);

    const holidayDates = new Set(
        (holidays || [])
            .map((h) => {
                const raw = h?.date;
                if (raw == null) return '';
                if (typeof raw === 'string') return raw.slice(0, 10);
                try {
                    return formatYmdEAT(toZonedTime(new Date(raw), EAT_TIMEZONE));
                } catch {
                    return '';
                }
            })
            .filter(Boolean),
    );

    while (isoWeekdayEAT(currentCheckDate) === '7' || holidayDates.has(formatYmdEAT(currentCheckDate))) {
        currentCheckDate = add(currentCheckDate, { days: 1 });
    }
    return currentCheckDate;
};

export const generateSchedule = (principal, interestRate, totalPayable, loanPeriod, periodUnit, repaymentFrequency, startDateString, holidays = []) => {
    const startDate = toZonedTime(new Date(startDateString), EAT_TIMEZONE);
    let installments = 0;
    
    const numericLoanPeriod = parseInt(loanPeriod, 10);
    if (isNaN(numericLoanPeriod) || numericLoanPeriod <= 0) return [];
    
    if (repaymentFrequency === 'daily') {
        if (periodUnit === 'months') installments = numericLoanPeriod * 30;
        else if (periodUnit === 'weeks') installments = numericLoanPeriod * 7;
        else if (periodUnit === 'days') installments = numericLoanPeriod;
    } else if (repaymentFrequency === 'weekly') {
        if (periodUnit === 'months') installments = numericLoanPeriod * 4;
        else if (periodUnit === 'days') installments = Math.floor(numericLoanPeriod / 7);
        else installments = numericLoanPeriod;
    } else if (repaymentFrequency === 'biweekly') {
        if (periodUnit === 'months') installments = numericLoanPeriod * 2;
        else if (periodUnit === 'days') installments = Math.floor(numericLoanPeriod / 14);
        else installments = Math.floor(numericLoanPeriod / 2);
    }
    else if (repaymentFrequency === 'monthly') {
        if (periodUnit === 'days') installments = Math.floor(numericLoanPeriod / 30);
        else if (periodUnit === 'weeks') installments = Math.floor(numericLoanPeriod / 4);
        else installments = numericLoanPeriod;
    }

    if (installments <= 0) return [];
    
    const installmentAmount = totalPayable / installments;
    const principalComponent = principal / installments;
    const interestComponent = (totalPayable - principal) / installments;

    const schedule = [];
    let lastDueDate = startDate;

    for (let i = 1; i <= installments; i++) {
        let nextProposedDate;

        if (i === 1) {
            nextProposedDate = lastDueDate;
        } else {
            nextProposedDate = addPeriod(lastDueDate, 1, repaymentFrequency);
        }

        let currentDueDate = getNextWorkingDay(nextProposedDate, holidays);
        
        schedule.push({
            installmentNumber: i,
            dueDate: formatYmdEAT(currentDueDate),
            amount: installmentAmount,
            principalComponent: principalComponent,
            interestComponent: interestComponent,
            paidAmount: 0,
            status: 'pending',
        });
        
        lastDueDate = currentDueDate;
    }
    return schedule;
};


export const calculateArrearsForLoan = (loan, serverDate) => {
    if (!loan || !loan.schedule) {
        return 0;
    }

    const today = toZonedTime(new Date(serverDate), EAT_TIMEZONE);
    
    // Set time to midnight for accurate date comparison
    today.setHours(0, 0, 0, 0);

    let arrears = 0;

    loan.schedule.forEach(installment => {
        const dueDate = toZonedTime(new Date(installment.dueDate), EAT_TIMEZONE);
        dueDate.setHours(0, 0, 0, 0);

        // LOGIC UPDATE: 
        // Backend 'recalculate_loan_schedule' sets status to 'arrears' ONLY if dueDate < today.
        // Previously we used <= which incorrectly counted today's dues as arrears.
        // We now align with backend logic: Strictly less than today.
        
        if (dueDate < today) {
             const dueAmount = installment.amount || 0;
             const paidAmount = installment.paidAmount || 0;
             if (paidAmount < (dueAmount - 0.01)) { // Tolerance for floating point
                 arrears += Math.max(0, dueAmount - paidAmount);
             }
        }
    });

    return arrears;
};


export const updateLoanStatuses = () => {
    console.log("This function is now a server-side RPC function and should not be called from the client.");
};