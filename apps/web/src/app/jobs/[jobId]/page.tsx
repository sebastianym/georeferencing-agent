import { JobView } from '@/components/app/job-view';

export default async function JobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  return <JobView jobId={jobId} />;
}
