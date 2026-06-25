import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { FieldWalletTraceSampleContent } from '@/components/admin/FieldWalletTraceSampleContent';

const FieldWalletTracePreview = () => {
  const navigate = useNavigate();

  return (
    <DashboardLayout title="Field wallet trace — sample">
      <div className="space-y-4">
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/admin/field-wallet-trace')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Live trace
        </Button>
        <FieldWalletTraceSampleContent showLoginHint={false} />
      </div>
    </DashboardLayout>
  );
};

export default FieldWalletTracePreview;
